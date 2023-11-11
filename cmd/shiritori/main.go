package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"

	evsifter "github.com/jiftechnify/strfry-evsifter"
	"github.com/nbd-wtf/go-nostr"
	emoji "github.com/tmdvs/Go-Emoji-Utils"
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
	trimmedContent := trimSpacesAndEmojis(input.Event.Content)
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
	regexpSpaces = regexp.MustCompile(`[\f\t\v\r\n\p{Zs}\x{85}\x{feff}\x{2028}\x{2029}]`)
	// ｡-ﾟ: halfwidth katakanas and punctuations
	regexpAllKanaOrJaPunct = regexp.MustCompile(`^[ぁ-ゖァ-ヶ｡-ﾟ。「」、・ー゛゜〜…！？!?-]+$`)
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

func trimSpacesAndEmojis(s string) string {
	return emoji.RemoveAll(regexpSpaces.ReplaceAllString(s, ""))
}

// returns head and last kana of string. kana will be normalized to fullwith katakana.
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

	var (
		head = normalizeKanaAt(runes, h)
		last = normalizeKanaAt(runes, l)
	)
	if head == 0 || last == 0 {
		return 0, 0, errors.New("effectiveHeadAndLast: something wrong")
	}
	return head, last, nil
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
