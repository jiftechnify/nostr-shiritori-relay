package main

import (
	"log"
	"testing"
)

func TestNormalizeText(t *testing.T) {
	if err := initialize(); err != nil {
		log.Fatal(err)
	}

	tests := []struct {
		in   string
		want string
	}{
		{in: "あいうえお", want: "あいうえお"},
		{in: "hoge　fuga\npiyo", want: "hoge fuga piyo"},
		{in: "URLはhttps://hoge.com/fuga.pngです!", want: "URLは です!"},
		{in: "To:nostr:npub168ghgug469n4r2tuyw05dmqhqv5jcwm7nxytn67afmz8qkc4a4zqsu2dlcこんにちは", want: "To: こんにちは"},
		{in: "わよ:wayo:", want: "わよ "},
		{in: "I'd like to", want: "アイド like to"},
		{in: "-1,234.56", want: "マイナスセンニヒャクサンジュウヨンテンゴロク"},
		{in: "Japan confirmed punk.", want: "Japan confirmed punk"},
	}

	for _, tt := range tests {
		if got := normalizeText(tt.in); got != tt.want {
			t.Errorf("normalizeText(%q) = %q; want %q", tt.in, got, tt.want)
		}
	}
}

func TestNaturalizeEnWordReading(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "アブサードゥ", want: "アブサード"},
		{in: "アドゥレッサビリティイ", want: "アドゥレッサビリティー"},
		{in: "ウォウ", want: "ウォー"},
		{in: "ウィロウ", want: "ウィロー"},
	}

	for _, tt := range tests {
		if got := naturalizeEnWordReading(tt.in); got != tt.want {
			t.Errorf("naturalizeEnWordReading(%q) = %q; want %q", tt.in, got, tt.want)
		}
	}
}

func TestNormalizeKanaAt(t *testing.T) {
	tests := []struct {
		in   string
		i    int
		want rune
	}{
		{in: "あいうえお", i: 0, want: 'ア'},
		{in: "あいうえお", i: 4, want: 'オ'},
		{in: "アイウエオ", i: 2, want: 'ウ'},
		{in: "がぎぐげご", i: 0, want: 'ガ'},
		{in: "ぱぴぷぺぽ", i: 0, want: 'パ'},
		{in: "ｱｲｳｴｵ", i: 0, want: 'ア'},
		{in: "ｱｲｳｴｵ", i: 4, want: 'オ'},
		{in: "ｯﾀｰﾝ", i: 0, want: 'ッ'},
		{in: "ﾐﾂｦ", i: 2, want: 'ヲ'},
		{in: "ｶﾞｷﾞｸﾞｹﾞｺﾞ", i: 0, want: 'ガ'},
		{in: "ｶﾞｷﾞｸﾞｹﾞｺﾞ", i: 8, want: 'ゴ'},
		{in: "ｶ゛ｷ゛ｸ゛ｹ゛ｺ゛", i: 0, want: 'ガ'},
		{in: "ｶ゛ｷ゛ｸ゛ｹ゛ｺ゛", i: 8, want: 'ゴ'},
		{in: "ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ", i: 0, want: 'パ'},
		{in: "ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ", i: 8, want: 'ポ'},
		{in: "ﾊ゜ﾋ゜ﾌ゜ﾍ゜ﾎ゜", i: 0, want: 'パ'},
		{in: "ﾊ゜ﾋ゜ﾌ゜ﾍ゜ﾎ゜", i: 8, want: 'ポ'},
		{in: "ﾅﾞﾆﾞﾇﾞﾈﾞﾉﾞ", i: 0, want: 'ナ'},
		{in: "ﾅﾞﾆﾞﾇﾞﾈﾞﾉﾞ", i: 8, want: 'ノ'},
		{in: "ﾅﾟﾆﾟﾇﾟﾈﾟﾉﾟ", i: 0, want: 'ナ'},
		{in: "ﾅﾟﾆﾟﾇﾟﾈﾟﾉﾟ", i: 8, want: 'ノ'},
		{in: "漢字", i: 0, want: 0},
	}

	for _, tt := range tests {
		if got := normalizeKanaAt([]rune(tt.in), tt.i); got != tt.want {
			t.Errorf("normalizeKanaAt(%q, %d) = %q; want %q", tt.in, tt.i, got, tt.want)
		}
	}
}

func TestEffectiveHeadAndList(t *testing.T) {
	if err := initialize(); err != nil {
		log.Fatal(err)
	}

	tests := []struct {
		in      string
		wantErr bool
		head    rune
		last    rune
	}{
		{in: "あいうえお", wantErr: false, head: 'ア', last: 'オ'},
		{in: "アイウエオ", wantErr: false, head: 'ア', last: 'オ'},
		{in: "ぽワ", wantErr: false, head: 'ポ', last: 'ワ'},
		{in: "マジ！？", wantErr: false, head: 'マ', last: 'ジ'},
		{in: "あーー", wantErr: false, head: 'ア', last: 'ア'},
		{in: "ゎょ", wantErr: false, head: 'ヮ', last: 'ョ'},
		{in: "りんごパイたびたぁい", wantErr: false, head: 'リ', last: 'イ'},
		{in: "うにゅう", wantErr: false, head: 'ウ', last: 'ウ'},
		{in: "ｳﾞｧｯ", wantErr: false, head: 'ヴ', last: 'ッ'},
		{in: "ｳｶﾞﾝﾀﾞ", wantErr: false, head: 'ウ', last: 'ダ'},
		{in: "ｳﾜｰ!", wantErr: false, head: 'ウ', last: 'ワ'},
		{in: "ｰｨｽ", wantErr: false, head: 'ィ', last: 'ス'},
		{in: "ｰｶﾞｷﾞ", wantErr: false, head: 'ガ', last: 'ギ'},
		{in: "漢字", wantErr: false, head: 'カ', last: 'ジ'},
		{in: "カナと漢字が混ざった文", wantErr: false, head: 'カ', last: 'ン'},
		{in: "ｶﾅと漢字が混ざった文", wantErr: false, head: 'カ', last: 'ン'},
		{in: "吾輩は猫である。名前はまだない。", wantErr: false, head: 'ワ', last: 'イ'},
		{in: "English!", wantErr: false, head: 'イ', last: 'ュ'},
		{in: "ostrich", wantErr: false, head: 'オ', last: 'チ'},
		{in: "Japan confirmed punk.", wantErr: false, head: 'ジ', last: 'ク'},
		{in: "Let's go at 9 o'clock!", wantErr: false, head: 'レ', last: 'ク'},
		{in: "mix English and 日本語", wantErr: false, head: 'ミ', last: 'ゴ'},
		{in: "kind 30078", wantErr: false, head: 'カ', last: 'チ'},
		{in: "-5ポイント", wantErr: false, head: 'マ', last: 'ト'},
		{in: "🍕", wantErr: false, head: 'ピ', last: 'ザ'},
		{in: "！？", wantErr: true, head: 0, last: 0},
	}

	for _, tt := range tests {
		head, last, err := effectiveHeadAndLast(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Errorf("effectiveHeadAndLast(%q) = %q, %q; want error", tt.in, head, last)
			}
		} else {
			if err != nil {
				t.Errorf("effectiveHeadAndLast(%q) = %q, %q, %v; want no error", tt.in, head, last, err)
			}
			if head != tt.head || last != tt.last {
				t.Errorf("effectiveHeadAndLast(%q) = %q, %q; want %q, %q", tt.in, head, last, tt.head, tt.last)
			}
		}
	}
}
