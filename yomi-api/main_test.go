package main

import (
	"log"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	if err := initialize(); err != nil {
		log.Fatal(err)
	}
	os.Exit(m.Run())
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
		{in: "ｳﾞｧｯ", wantErr: false, head: 'ヴ', last: 'ッ'},
		{in: "ｳｶﾞﾝﾀﾞ", wantErr: false, head: 'ウ', last: 'ダ'},
		{in: "ｳﾜｰ!", wantErr: false, head: 'ウ', last: 'ワ'},
		{in: "漢字", wantErr: false, head: 'カ', last: 'ジ'},
		{in: "カナと漢字が混ざった文", wantErr: false, head: 'カ', last: 'ン'},
		{in: "ｶﾅと漢字が混ざった文", wantErr: false, head: 'カ', last: 'ン'},
		{in: "吾輩は猫である。名前はまだない。", wantErr: false, head: 'ワ', last: 'イ'},
		{in: "English!", wantErr: false, head: 'イ', last: 'ュ'},
		{in: "ostrich", wantErr: false, head: 'オ', last: 'チ'},
		{in: "Japan confirmed punk.", wantErr: false, head: 'ジ', last: 'ク'},
		{in: "Let's go at 9 o'clock!", wantErr: false, head: 'レ', last: 'ク'},
		{in: "mix English and 日本語", wantErr: false, head: 'ミ', last: 'ゴ'},
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
