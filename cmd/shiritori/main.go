package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"

	evsifter "github.com/jiftechnify/strfry-evsifter"
	"github.com/nbd-wtf/go-nostr"
)

func main() {
	var r evsifter.Runner
	r.SiftWithFunc(shiritoriSifter)
	r.Run()
}

func shiritoriSifter(input *evsifter.Input) (*evsifter.Result, error) {
	if _, ok := nonRestrictedKinds[input.Event.Kind]; ok {
		return input.Accept()
	}
	if input.Event.Kind != nostr.KindTextNote {
		return input.ShadowReject()
	}
	// kind: 1 (Text Note)
	// reject replies
	if hasTagOfName(input.Event, "e") {
		return input.ShadowReject()
	}

	// reject if content has characters not allowed
	trimmedContent := regexpSpaces.ReplaceAllString(input.Event.Content, "")
	if !regexpAllKanaOrJaPunct.MatchString(trimmedContent) {
		return input.Reject("blocked: content of post has non-kana letters")
	}

	// shiritori judgement
	head, last, err := effectiveHeadAndLast(trimmedContent)
	if err != nil {
		return input.Reject("blocked: content of post has no kana")
	}

	f, err := os.OpenFile("./resource/last_kana.txt", os.O_RDWR|os.O_CREATE, 0666)
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

		if !isShiritoriConnected(prevLast, head) {
			return input.Reject("blocked: shiritori not connected")
		}
	}

	if err := saveLastKana(f, last); err != nil {
		return nil, err
	}
	return input.Accept()
}

var nonRestrictedKinds = map[int]struct{}{
	nostr.KindSetMetadata: {},
	nostr.KindReaction:    {},
}

func hasTagOfName(event *nostr.Event, name string) bool {
	for _, tag := range event.Tags {
		if len(tag) != 0 && tag[0] == name {
			return true
		}
	}
	return false
}

var (
	regexpSpaces           = regexp.MustCompile(`\f\t\v\r\n\p{Zs}\x{85}\x{feff}\x{2028}\x{2029}`)
	regexpAllKanaOrJaPunct = regexp.MustCompile(`[ぁ-ゖァ-ヶ、。・ー！？]+`)
)

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

// [ぁ-ゖ]
func isHiragana(r rune) bool {
	return 0x3041 <= r && r <= 0x3096
}

// [ァ-ヶ]
func isKatakana(r rune) bool {
	return 0x30A1 <= r && r <= 0x30F6
}

func isKana(r rune) bool {
	return isHiragana(r) || isKatakana(r)
}

func toKatakana(r rune) rune {
	if isHiragana(r) {
		return r + 0x60
	}
	return r
}

func effectiveHeadAndLast(s string) (rune, rune, error) {
	runes := []rune(s)

	var (
		h = 0
		l = len(runes) - 1
	)
	for ; h < len(runes); h++ {
		if isKana(runes[h]) {
			break
		}
	}
	for ; l >= 0; l-- {
		if isKana(runes[l]) {
			break
		}
	}

	if h > l {
		return 0, 0, errors.New("no kana in string")
	}
	return runes[h], runes[l], nil
}

func isShiritoriConnected(prevLast, currHead rune) bool {
	var (
		prevLastKata = toKatakana(prevLast)
		currHeadKata = toKatakana(currHead)
	)

	if prevLastKata == currHeadKata {
		return true
	}
	if allowed, ok := allowedConnections[prevLastKata]; ok {
		for _, r := range allowed {
			if r == currHeadKata {
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
