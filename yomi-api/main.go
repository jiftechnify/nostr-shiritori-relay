package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	ipaneologd "github.com/ikawaha/kagome-dict-ipa-neologd"
	"github.com/ikawaha/kagome/v2/tokenizer"
)

var (
	//go:embed dicts
	dicts embed.FS

	readingDict = make(map[string]string)
	replaceDict = make(map[*regexp.Regexp]string)

	kagomeTokenizer *tokenizer.Tokenizer
)

func parseReadingDict(path string) error {
	f, err := dicts.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open dictionary file: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		split := strings.Split(line, " ")
		if len(split) < 2 {
			continue
		}
		readingDict[split[0]] = split[1]
	}
	return nil
}

func parseReplaceDict(path string) error {
	f, err := dicts.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open dictionary file: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		split := strings.Split(line, " ")
		if len(split) < 2 {
			continue
		}
		re := regexp.MustCompile(fmt.Sprintf(`\b(?i:%s)\b`, split[0]))
		replaceDict[re] = naturalizeEnWordReading(split[1])
	}
	return nil
}

func initialize() error {
	var err error
	kagomeTokenizer, err = tokenizer.New(ipaneologd.Dict(), tokenizer.OmitBosEos())
	if err != nil {
		return fmt.Errorf("failed to initialize kagome tokenizer: %w", err)
	}

	if err := parseReadingDict("dicts/bep-eng.dic"); err != nil {
		return err
	}
	if err := parseReadingDict("dicts/custom.dic"); err != nil {
		return err
	}

	if err := parseReplaceDict("dicts/replace.dic"); err != nil {
		return err
	}
	return nil
}

func main() {
	if err := initialize(); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/", handleHeadLastKana)
	http.HandleFunc("/health", handleHealth)

	log.Print("listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}

type HeadLastKanaResp struct {
	Readable bool `json:"readable"`
	Head     rune `json:"head,omitempty"`
	Last     rune `json:"last,omitempty"`
}

func handleHeadLastKana(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_, _ = fmt.Fprintf(w, "method not allowed")
		return
	}

	content := r.URL.Query().Get("c")
	head, last, err := effectiveHeadAndLast(content)

	var resp HeadLastKanaResp
	if err != nil {
		log.Printf("failed to determine head/last of reading of content(%q) %v", content, err)
		resp.Readable = false
	} else {
		resp.Readable = true
		resp.Head = head
		resp.Last = last
	}
	jenc := json.NewEncoder(w)
	jenc.SetIndent("", "")
	_ = jenc.Encode(resp)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	log.Print("health checked")
	_, _ = fmt.Fprintf(w, "ok")
}

// returns head and last kana of reading of the text. resulting kana will be normalized to fullwith katakana.
func effectiveHeadAndLast(s string) (rune, rune, error) {
	normalized := normalizeText(s)
	tokens := kagomeTokenizer.Tokenize(normalized)

	var (
		h = 0
		l = len(tokens) - 1

		head rune
		last rune
	)

	for ; h < len(tokens); h++ {
		if head = headKanaOfToken(tokens[h]); head != 0 {
			break
		}
	}
	for ; l >= h; l-- {
		if last = lastKanaOfToken(tokens[l]); last != 0 {
			break
		}
	}

	if head == 0 || last == 0 {
		return 0, 0, errors.New("effectiveHeadAndLast: something wrong")
	}
	return head, last, nil
}

var hwKana2FwKana = map[rune]rune{
	'ｦ': 'ヲ',
	'ｧ': 'ァ',
	'ｨ': 'ィ',
	'ｩ': 'ゥ',
	'ｪ': 'ェ',
	'ｫ': 'ォ',
	'ｬ': 'ャ',
	'ｭ': 'ュ',
	'ｮ': 'ョ',
	'ｯ': 'ッ',
	'ｱ': 'ア',
	'ｲ': 'イ',
	'ｳ': 'ウ',
	'ｴ': 'エ',
	'ｵ': 'オ',
	'ｶ': 'カ',
	'ｷ': 'キ',
	'ｸ': 'ク',
	'ｹ': 'ケ',
	'ｺ': 'コ',
	'ｻ': 'サ',
	'ｼ': 'シ',
	'ｽ': 'ス',
	'ｾ': 'セ',
	'ｿ': 'ソ',
	'ﾀ': 'タ',
	'ﾁ': 'チ',
	'ﾂ': 'ツ',
	'ﾃ': 'テ',
	'ﾄ': 'ト',
	'ﾅ': 'ナ',
	'ﾆ': 'ニ',
	'ﾇ': 'ヌ',
	'ﾈ': 'ネ',
	'ﾉ': 'ノ',
	'ﾊ': 'ハ',
	'ﾋ': 'ヒ',
	'ﾌ': 'フ',
	'ﾍ': 'ヘ',
	'ﾎ': 'ホ',
	'ﾏ': 'マ',
	'ﾐ': 'ミ',
	'ﾑ': 'ム',
	'ﾒ': 'メ',
	'ﾓ': 'モ',
	'ﾔ': 'ヤ',
	'ﾕ': 'ユ',
	'ﾖ': 'ヨ',
	'ﾗ': 'ラ',
	'ﾘ': 'リ',
	'ﾙ': 'ル',
	'ﾚ': 'レ',
	'ﾛ': 'ロ',
	'ﾜ': 'ワ',
	'ﾝ': 'ン',
}

var hwDakuon2FwKana = map[rune]rune{
	'ｶ': 'ガ',
	'ｷ': 'ギ',
	'ｸ': 'グ',
	'ｹ': 'ゲ',
	'ｺ': 'ゴ',
	'ｻ': 'ザ',
	'ｼ': 'ジ',
	'ｽ': 'ズ',
	'ｾ': 'ゼ',
	'ｿ': 'ゾ',
	'ﾀ': 'ダ',
	'ﾁ': 'ヂ',
	'ﾂ': 'ヅ',
	'ﾃ': 'デ',
	'ﾄ': 'ド',
	'ﾊ': 'バ',
	'ﾋ': 'ビ',
	'ﾌ': 'ブ',
	'ﾍ': 'ベ',
	'ﾎ': 'ボ',
	'ｳ': 'ヴ',
}

var hwHandakuon2FwKana = map[rune]rune{
	'ﾊ': 'パ',
	'ﾋ': 'ピ',
	'ﾌ': 'プ',
	'ﾍ': 'ペ',
	'ﾎ': 'ポ',
}

var enAlphabetReadings = map[rune]string{
	'A': "エー",
	'B': "ビー",
	'C': "シー",
	'D': "ディー",
	'E': "イー",
	'F': "エフ",
	'G': "ジー",
	'H': "エイチ",
	'I': "アイ",
	'J': "ジェー",
	'K': "ケー",
	'L': "エル",
	'M': "エム",
	'N': "エヌ",
	'O': "オー",
	'P': "ピー",
	'Q': "キュー",
	'R': "アール",
	'S': "エス",
	'T': "ティー",
	'U': "ユー",
	'V': "ブイ",
	'W': "ダブリュー",
	'X': "エックス",
	'Y': "ワイ",
	'Z': "ゼット",
}

// [ぁ-ゖ]
func isHiragana(r rune) bool {
	return 0x3041 <= r && r <= 0x3096
}

// [ァ-ヶ]
func isFullwidthKatakana(r rune) bool {
	return 0x30A1 <= r && r <= 0x30F6
}

// [ｦ-ｯｱ-ﾝ](halfwidth katakana except 'ｰ')
func isHalfwidthKatakana(r rune) bool {
	return 0xFF66 <= r && r <= 0xFF6F || 0xFF71 <= r && r <= 0xFF9D
}

func isKana(r rune) bool {
	return isHiragana(r) || isFullwidthKatakana(r) || isHalfwidthKatakana(r)
}

// normalize single kana rune to fullwidth katakana.
func normalizeSingleKana(r rune) rune {
	if isFullwidthKatakana(r) {
		return r
	}
	if isHiragana(r) {
		return r + 0x60
	}
	if isHalfwidthKatakana(r) {
		return hwKana2FwKana[r]
	}
	return 0
}

// normalize kana rs[i] to fullwidth katakana.
// if rs[i] is halfwidth katakana that have (han-)dakuon form and rs[i+1] is (han-)dakuten, result will be (han-)dakuon form.
// if input is invalid, return 0.
func normalizeKanaAt(rs []rune, i int) rune {
	r := rs[i]

	if isFullwidthKatakana(r) {
		return r
	}
	if isHiragana(r) {
		return r + 0x60
	}
	if isHalfwidthKatakana(r) {
		if len(rs) > i+1 {
			switch rs[i+1] {
			case 'ﾞ', '゛':
				if d, ok := hwDakuon2FwKana[r]; ok {
					return d
				}
			case 'ﾟ', '゜':
				if d, ok := hwHandakuon2FwKana[r]; ok {
					return d
				}
			}
		}
		return hwKana2FwKana[r]
	}
	return 0
}

var (
	regexpSpaces      = regexp.MustCompile(`[\f\t\v\r\n\p{Zs}\x{85}\x{feff}\x{2028}\x{2029}]`)
	regexpHTTPURI     = regexp.MustCompile(`(https?|wss?)://[[:graph:]]+`)
	regexpNostrID     = regexp.MustCompile(`(nostr:)?n(pub|sec|profile|event|ote|addr|relay)1[[:alnum:]]+`)
	regexpCustomEmoji = regexp.MustCompile(`:[[:word:]]+:`)
	regexpNumber      = regexp.MustCompile(`-?[[:digit:],_.]+`)
)

// normalize the string for determining reading.
//
// normalization proecss includes:
//   - normalizing various space characters to the "normal" space
//   - removing http/ws URIs, Nostr IDs (`nxxx1...` things, including `nostr:` prefix) and custom emoji shortcodes (e.g. ":foo:")
//   - replacing numbers (sequences of digits) with their readings
//   - trimming trailing period
//   - replacing words in replace dictionary
//
// trimming trailing period is necessary because kagome tokenizer sometimes group "the last character of word and the next period" mistakenly(e.g. "punk." -> ["pun", "k."]).
// replacing words is necessary because kagome tokenizer tokenizes words that have "'" in wrong way.
func normalizeText(s string) string {
	res := regexpSpaces.ReplaceAllString(s, " ")
	res = regexpHTTPURI.ReplaceAllString(res, " ")
	res = regexpNostrID.ReplaceAllString(res, " ")
	res = regexpCustomEmoji.ReplaceAllString(res, " ")
	res = regexpNumber.ReplaceAllStringFunc(res, func(s string) string {
		cut, isNeg := strings.CutPrefix(s, "-")
		numReading := getNumberReading(strings.NewReplacer(",", "", "_", "").Replace(cut))
		if isNeg {
			return "マイナス" + numReading
		} else {
			return numReading
		}
	})
	res = strings.TrimRight(res, ".")

	for re, repl := range replaceDict {
		res = re.ReplaceAllString(res, repl)
	}
	return res
}

// credit to basic idea: https://gist.github.com/ikegami-yukino/2213879
// only replaces end of readings, which affect shiritori connections.
var enWordReadingNaturalizations = map[*regexp.Regexp]string{
	regexp.MustCompile(`([ドト])ゥ$`):       "$1",
	regexp.MustCompile(`([キシチニヒミリィ])イ$`): "${1}ー",
	regexp.MustCompile(`ォウ$`):            "ォー",
	regexp.MustCompile(`ロウ$`):            "ロー",
}

func naturalizeEnWordReading(r string) string {
	res := r
	for re, repl := range enWordReadingNaturalizations {
		res = re.ReplaceAllString(res, repl)
	}
	return res
}

// pre-condition: word is uppercased
func getEnWordReading(word string) (string, bool) {
	if r, ok := readingDict[word]; ok {
		return naturalizeEnWordReading(r), true
	}
	return "", false
}

var (
	regexpAllEnAlphabet = regexp.MustCompile(`^[a-zA-Z]+$`)
	regexpAllHwKana     = regexp.MustCompile(`^[ｦ-ﾟ]+$`)
	regexpAllFwKana     = regexp.MustCompile(`^[ぁ-ゖァ-ヶ]+$`)
)

func headKanaOfToken(t tokenizer.Token) rune {
	// if the token consists of only fullwidth katakana, just get head
	if regexpAllFwKana.MatchString(t.Surface) {
		return normalizeSingleKana([]rune(t.Surface)[0])
	}

	// if the token consists of only halfwidth katakana, get head and convert it to fullwidth
	if regexpAllHwKana.MatchString(t.Surface) {
		rs := []rune(t.Surface)
		h := 0
		for ; h < len(rs); h++ {
			if isKana(rs[h]) {
				break
			}
		}
		if h >= len(rs) {
			return 0
		}
		return normalizeKanaAt(rs, h)
	}

	// get head kana from reading of the token
	if r, ok := t.Reading(); ok {
		if k := headKana(r); k != 0 {
			return k
		}
	}

	// if the token is likely an English word...
	if regexpAllEnAlphabet.MatchString(t.Surface) {
		// first, get reading from dictionary and get head kana
		upper := strings.ToUpper(t.Surface)
		if r, ok := getEnWordReading(upper); ok {
			if k := headKana(r); k != 0 {
				return k
			}
		}
		// if reading is not available, use literal reading of first alphabet
		if r, ok := enAlphabetReadings[rune(upper[0])]; ok {
			if k := headKana(r); k != 0 {
				return k
			}
		}
		return 0
	}

	// get head kana from surface form of the token
	if k := headKana(t.Surface); k != 0 {
		return normalizeSingleKana(k)
	}

	return 0
}

func headKana(r string) rune {
	for _, c := range r {
		if isKana(c) {
			return c
		}
	}
	return 0
}

func lastKanaOfToken(t tokenizer.Token) rune {
	// if the token consists of only fullwidth katakana, just get last
	if regexpAllFwKana.MatchString(t.Surface) {
		rs := []rune(t.Surface)
		return normalizeSingleKana(rs[len(rs)-1])
	}

	// if the token consists of only halfwidth katakana, get last and convert it to fullwidth
	if regexpAllHwKana.MatchString(t.Surface) {
		rs := []rune(t.Surface)
		l := len(rs) - 1
		for ; l >= 0; l-- {
			if isKana(rs[l]) {
				break
			}
		}
		if l < 0 {
			return 0
		}
		return normalizeKanaAt(rs, l)
	}

	// get last kana from reading of the token
	if r, ok := t.Reading(); ok {
		if k := lastKana(r); k != 0 {
			return k
		}
	}

	// if the token is likely an English word...
	if regexpAllEnAlphabet.MatchString(t.Surface) {
		// first, get reading from dictionary and get last kana
		upper := strings.ToUpper(t.Surface)
		if r, ok := getEnWordReading(upper); ok {
			if k := lastKana(r); k != 0 {
				return k
			}
		}
		// if reading is not available, use literal reading of last alphabet
		if r, ok := enAlphabetReadings[rune(upper[len(upper)-1])]; ok {
			if k := lastKana(r); k != 0 {
				return k
			}
		}
		return 0
	}

	// get last kana from surface form of the token
	if k := lastKana(t.Surface); k != 0 {
		return normalizeSingleKana(k)
	}
	return 0
}

func lastKana(r string) rune {
	rs := []rune(r)
	for i := len(rs) - 1; i >= 0; i-- {
		if isKana(rs[i]) {
			return rs[i]
		}
	}
	return 0
}
