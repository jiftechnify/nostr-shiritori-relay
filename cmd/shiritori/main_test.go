package main

import (
	"testing"
)

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

func TestAllKanaOrJaPunct(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{in: "あいうえお", want: true},
		{in: "アイウエオ", want: true},
		{in: "！？", want: true},
		{in: "ぽわーー！ーー！", want: true},
		{in: "ｳﾞｧｯ!?", want: true},
		{in: "ああNostr", want: false},
		{in: "🐧ぽわ🐧", want: true},
		{in: "🦩nos🦩", want: false},
		{in: "🎍竹🎍", want: false},
		{in: "あ い\nう", want: true},
		{in: "あ i\nう", want: false},
		{in: "あ 異\nウ", want: false},
	}

	for _, tt := range tests {
		trimmedContent := trimSpacesAndEmojis(tt.in)
		if got := regexpAllKanaOrJaPunct.MatchString(trimmedContent); got != tt.want {
			t.Errorf("regexpAllKanaOrJaPunct.MatchString(%q) = %v; want %v", trimmedContent, got, tt.want)
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
		{in: "ｳﾞｧｯ", wantErr: false, head: 'ヴ', last: 'ッ'},
		{in: "ｳｶﾞﾝﾀﾞ", wantErr: false, head: 'ウ', last: 'ダ'},
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
			if head != tt.head {
				t.Errorf("effectiveHeadAndLast(%q) = %q, %q; want %q, %q", tt.in, head, last, tt.head, tt.last)
			}
			if last != tt.last {
				t.Errorf("effectiveHeadAndLast(%q) = %q, %q; want %q, %q", tt.in, head, last, tt.head, tt.last)
			}
		}
	}
}

func TestIsShiritoriConnected(t *testing.T) {
	tests := []struct {
		prevLast rune
		currHead rune
		want     bool
	}{
		{prevLast: 'ア', currHead: 'ア', want: true},
		{prevLast: 'ア', currHead: 'イ', want: false},
		{prevLast: 'ガ', currHead: 'カ', want: true},
		{prevLast: 'カ', currHead: 'ガ', want: false},
		{prevLast: 'ッ', currHead: 'ツ', want: true},
		{prevLast: 'ヴ', currHead: 'ウ', want: true},
		{prevLast: 'ヴ', currHead: 'ブ', want: true},
	}

	for _, tt := range tests {
		if got := isShiritoriConnected(tt.prevLast, tt.currHead); got != tt.want {
			t.Errorf("isConnectionAllowed(%q, %q) = %v; want %v", tt.prevLast, tt.currHead, got, tt.want)
		}
	}
}
