package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jiftechnify/strfrui"
	"github.com/nbd-wtf/go-nostr"
)

var (
	resourceDirPath string
	yomiAPIBaseURL  string
)

var (
	nonRestrictedPubkeys = make(map[string]struct{})
	blockedPubkeys       = make(map[string]struct{})
)

var (
	regexpCommands  = regexp.MustCompile(`^!.+$`)
	regexpHexPubkey = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func readPubkeyListFile(path string, m map[string]struct{}) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		pk := scanner.Text()
		if !regexpHexPubkey.MatchString(pk) {
			return fmt.Errorf("malformed pubkey in pubkey list: %s", pk)
		}
		m[pk] = struct{}{}
	}
	return nil
}

func initialize() error {
	http.DefaultClient.Timeout = 5 * time.Second

	// load env vars
	if resourceDirPath = os.Getenv("RESOURCE_DIR"); resourceDirPath == "" {
		return errors.New("RESOURCE_DIR is not set in .env")
	}
	if yomiAPIBaseURL = os.Getenv("YOMI_API_BASE_URL"); yomiAPIBaseURL == "" {
		return errors.New("YOMI_API_BASE_URL is not set in .env")
	}

	// load pubkey list
	if err := readPubkeyListFile(filepath.Join(resourceDirPath, "non_restricted_pubkeys.txt"), nonRestrictedPubkeys); err != nil {
		return err
	}
	if err := readPubkeyListFile(filepath.Join(resourceDirPath, "blocked_pubkeys.txt"), blockedPubkeys); err != nil {
		return err
	}
	return nil
}

func main() {
	if err := initialize(); err != nil {
		log.Fatal(err)
	}

	strfrui.NewWithSifterFunc(shiritoriSifter).Run()
}

type fakableClock struct {
	fakedNow time.Time
}

func (c fakableClock) Now() time.Time {
	if !c.fakedNow.IsZero() {
		return c.fakedNow
	}
	return time.Now()
}

func (c *fakableClock) SetFake(t time.Time) {
	c.fakedNow = t
}

var clock = &fakableClock{}

func shiritoriSifter(input *strfrui.Input) (*strfrui.Result, error) {
	// reject events that don't have created_at within 1 minute of window from now
	now := clock.Now()
	createdAt := input.Event.CreatedAt.Time()
	if createdAt.Before(now.Add(-1*time.Minute)) || createdAt.After(now.Add(1*time.Minute)) {
		return input.ShadowReject()
	}

	if _, ok := nonRestrictedKinds[input.Event.Kind]; ok {
		return input.Accept()
	}

	if input.Event.Kind != nostr.KindTextNote {
		return input.ShadowReject()
	}
	// kind: 1 (Text Note)
	// accept notes from non-restricted pubkeys (bots)
	if _, ok := nonRestrictedPubkeys[input.Event.PubKey]; ok {
		log.Printf("accepting note from non-restricted pubkey: %s", input.Event.Content)
		return input.Accept()
	}
	// reject notes from blocked pubkeys
	if _, ok := blockedPubkeys[input.Event.PubKey]; ok {
		return input.ShadowReject()
	}

	// reject replies
	if hasTagOfName(input.Event, "e") {
		log.Print("rejecting replies")
		return input.ShadowReject()
	}
	// accept bot commands
	if regexpCommands.MatchString(input.Event.Content) {
		if isCommandValid(input.Event.Content) {
			log.Printf("accepting bot command: %s", input.Event.Content)
			return input.Accept()
		} else {
			return input.Reject("blocked: bot command not supported")
		}
	}

	// shiritori judgement
	hl, err := getHeadLastKana(input.Event.Content)
	if err != nil {
		log.Printf("failed to determine head/last of reading of content(%q): %v", input.Event.Content, err)
		return input.Reject("blocked: couldn't determine head/last of reading of content")
	}
	if !hl.Readable {
		log.Printf("content(%q) is not readable", input.Event.Content)
		return input.Reject("blocked: couldn't determine head/last of reading of content")
	}

	f, err := os.OpenFile(filepath.Join(resourceDirPath, "last_kana.txt"), os.O_RDWR|os.O_CREATE, 0666)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	b, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	if len(b) > 0 {
		s := string(b)
		prevLast := []rune(s)[0]

		if !isShiritoriConnected(prevLast, hl.Head) {
			log.Printf("❌Rejected! content: %s, head: %c, last: %c", strings.ReplaceAll(input.Event.Content, "\n", " "), hl.Head, hl.Last)
			return input.Reject("blocked: shiritori not connected")
		}
	}

	if err := saveLastKana(f, hl.Last); err != nil {
		return nil, err
	}
	log.Printf("✅Accepted! content: %s, head: %c, last: %c", strings.ReplaceAll(input.Event.Content, "\n", " "), hl.Head, hl.Last)
	return input.Accept()
}

var nonRestrictedKinds = map[int]struct{}{
	nostr.KindReaction: {},
}

func hasTagOfName(event *nostr.Event, name string) bool {
	for _, tag := range event.Tags {
		if len(tag) != 0 && tag[0] == name {
			return true
		}
	}
	return false
}

type HeadLastKanaResp struct {
	Readable bool `json:"readable"`
	Head     rune `json:"head,omitempty"`
	Last     rune `json:"last,omitempty"`
}

func getHeadLastKana(c string) (*HeadLastKanaResp, error) {
	u, err := url.Parse(yomiAPIBaseURL)
	if err != nil {
		return nil, err
	}
	qv := url.Values{"c": []string{c}}
	u.RawQuery = qv.Encode()

	resp, err := http.Get(u.String())
	if err != nil {
		return nil, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	var r HeadLastKanaResp
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func isCommandValid(cmd string) bool {
	checker, err := net.Dial("unix", filepath.Join(resourceDirPath, "bot_cmd_check.sock"))
	if err != nil {
		log.Printf("failed to connect to command checker: %v", err)
		return false
	}
	defer checker.Close()

	if _, err := checker.Write([]byte(cmd)); err != nil {
		log.Printf("failed to send request to command checker: %v", err)
		return false
	}

	var resBuf strings.Builder
	if _, err := io.Copy(&resBuf, checker); err != nil {
		log.Printf("failed to receive result from command checker: %v", err)
		return false
	}
	return resBuf.String() == "ok"
}

var allowedConnections = map[rune][]rune{
	'ァ': {'ア'},
	'ィ': {'イ'},
	'ゥ': {'ウ'},
	'ェ': {'エ'},
	'ォ': {'オ'},
	'ガ': {'カ'},
	'ギ': {'キ'},
	'グ': {'ク'},
	'ゲ': {'ケ'},
	'ゴ': {'コ'},
	'ザ': {'サ'},
	'ジ': {'シ'},
	'ズ': {'ス'},
	'ゼ': {'セ'},
	'ゾ': {'ソ'},
	'ダ': {'タ'},
	'ヂ': {'チ'},
	'ッ': {'ツ'},
	'ヅ': {'ツ'},
	'デ': {'テ'},
	'ド': {'ト'},
	'バ': {'ハ'},
	'パ': {'ハ'},
	'ビ': {'ヒ'},
	'ピ': {'ヒ'},
	'ブ': {'フ'},
	'プ': {'フ'},
	'ベ': {'ヘ'},
	'ペ': {'ヘ'},
	'ボ': {'ホ'},
	'ポ': {'ホ'},
	'ャ': {'ヤ'},
	'ュ': {'ユ'},
	'ョ': {'ヨ'},
	'ヮ': {'ワ'},
	'ヰ': {'イ'},
	'ヱ': {'エ'},
	'ヲ': {'オ'},
	'ヴ': {'ウ', 'ブ'},
	'ヵ': {'カ'},
	'ヶ': {'ケ'},
}

// pre-condition: prevLast and currHead are normalized to fullwidth katakana
func isShiritoriConnected(prevLast, currHead rune) bool {
	if prevLast == currHead {
		return true
	}
	if allowed, ok := allowedConnections[prevLast]; ok {
		for _, r := range allowed {
			if r == currHead {
				return true
			}
		}
	}
	return false
}

func saveLastKana(f *os.File, last rune) error {
	if err := f.Truncate(0); err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(f, "%c", last); err != nil {
		return err
	}
	return nil
}
