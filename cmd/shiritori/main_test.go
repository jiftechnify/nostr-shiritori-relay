package main

import (
	"testing"
)

func TestToKatakana(t *testing.T) {
	tests := []struct {
		in   rune
		want rune
	}{
		{in: 'あ', want: 'ア'},
		{in: 'ぁ', want: 'ァ'},
		{in: 'が', want: 'ガ'},
		{in: 'ゔ', want: 'ヴ'},
		{in: 'ー', want: 'ー'},
	}

	for _, tt := range tests {
		if got := toKatakana(tt.in); got != tt.want {
			t.Errorf("toKatakana(%q) = %q; want %q", tt.in, got, tt.want)
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
		{in: "あいうえお", wantErr: false, head: 'あ', last: 'お'},
		{in: "アイウエオ", wantErr: false, head: 'ア', last: 'オ'},
		{in: "ぽワ", wantErr: false, head: 'ぽ', last: 'ワ'},
		{in: "マジ！？", wantErr: false, head: 'マ', last: 'ジ'},
		{in: "あーー", wantErr: false, head: 'あ', last: 'あ'},
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
		{prevLast: 'あ', currHead: 'あ', want: true},
		{prevLast: 'ア', currHead: 'あ', want: true},
		{prevLast: 'あ', currHead: 'ア', want: true},
		{prevLast: 'あ', currHead: 'い', want: false},
		{prevLast: 'が', currHead: 'カ', want: true},
		{prevLast: 'か', currHead: 'が', want: false},
		{prevLast: 'ヴ', currHead: 'う', want: true},
		{prevLast: 'ゔ', currHead: 'ブ', want: true},
	}

	for _, tt := range tests {
		if got := isShiritoriConnected(tt.prevLast, tt.currHead); got != tt.want {
			t.Errorf("isConnectionAllowed(%q, %q) = %v; want %v", tt.prevLast, tt.currHead, got, tt.want)
		}
	}
}
