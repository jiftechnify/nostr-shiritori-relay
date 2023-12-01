package main

import (
	"strings"
)

var basicDigitReading = map[rune]string{
	'0': "ゼロ",
	'1': "イチ",
	'2': "ニ",
	'3': "サン",
	'4': "ヨン",
	'5': "ゴ",
	'6': "ロク",
	'7': "ナナ",
	'8': "ハチ",
	'9': "キュウ",
	'.': "テン",
}

type smallNumDigitIdx int

const (
	thousands smallNumDigitIdx = 0
	hundreds  smallNumDigitIdx = 1
	tens      smallNumDigitIdx = 2
)

type digitWithIdx struct {
	digit rune
	idx   smallNumDigitIdx
}

var specialDigitReading = map[digitWithIdx]string{
	{digit: '1', idx: thousands}: "セン",
	{digit: '1', idx: hundreds}:  "ヒャク",
	{digit: '1', idx: tens}:      "ジュウ",
	{digit: '3', idx: thousands}: "サンゼン",
	{digit: '3', idx: hundreds}:  "サンビャク",
	{digit: '6', idx: hundreds}:  "ロッピャク",
	{digit: '8', idx: thousands}: "ハッセン",
	{digit: '8', idx: hundreds}:  "ハッピャク",
}

func literalReadling(strNum string) string {
	res := ""
	for _, r := range strNum {
		res += basicDigitReading[r]
	}
	return res
}

func smallIntReading(runes []rune) string {
	res := ""
	bias := 4 - len(runes)
	for i, r := range runes {
		if r == '0' {
			continue
		}
		if read, ok := specialDigitReading[digitWithIdx{digit: r, idx: smallNumDigitIdx(i + bias)}]; ok {
			res += read
			continue
		}
		res += basicDigitReading[r]
		switch i + bias {
		case 0:
			res += "セン"
		case 1:
			res += "ヒャク"
		case 2:
			res += "ジュウ"
		}
	}
	return res
}

// nasal sound change = 促音便
func applyNasalSoundChange(r string) string {
	if cut, found := strings.CutSuffix(r, "イチ"); found {
		return cut + "イッ"
	}
	if cut, found := strings.CutSuffix(r, "ハチ"); found {
		return cut + "ハッ"
	}
	if cut, found := strings.CutSuffix(r, "ジュウ"); found {
		return cut + "ジッ"
	}
	return r
}

func intPartReading(strInt string) string {
	if strInt == "" {
		return ""
	}
	if strInt == "0" {
		return "ゼロ"
	}

	res := ""
	runes := []rune(strInt)
	for i := 4; i >= 1; i-- {
		if len(runes) <= 4*(i-1) {
			continue
		}
		smallRes := smallIntReading(runes[max(len(runes)-4*i, 0) : len(runes)-4*(i-1)])
		if smallRes == "" {
			continue
		}
		res += smallRes
		switch i {
		case 4:
			res = applyNasalSoundChange(res)
			res += "チョウ"
		case 3:
			res += "オク"
		case 2:
			res += "マン"
		}
	}
	return res
}

func getNumberReading(strNum string) string {
	parts := strings.Split(strNum, ".")
	if len(parts) >= 3 {
		return literalReadling(strNum)
	}

	intPart := parts[0]
	if len(intPart) >= 2 && intPart[0] == '0' || len(intPart) > 16 {
		return literalReadling(strNum)
	}
	// read integer part
	res := intPartReading(intPart)

	// read decimal part
	// if decimal part is empty (e.g. input is like "1."), don't read "."
	if len(parts) == 2 && parts[1] != "" {
		if res == "ゼロ" {
			res = "レイ"
		}
		res = applyNasalSoundChange(res)
		res += "テン"
		res += literalReadling(parts[1])
	}
	return res
}
