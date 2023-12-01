package main

import (
	"testing"
	"time"

	evsifter "github.com/jiftechnify/strfry-evsifter"
	"github.com/nbd-wtf/go-nostr"
)

const (
	fakeNowUnix = 1700000000
)

func nostrTS(t time.Time) nostr.Timestamp {
	return nostr.Timestamp(t.Unix())
}

func testEvent(mod func(ev *nostr.Event)) *nostr.Event {
	ev := &nostr.Event{
		ID:        "id",
		PubKey:    "pubkey",
		CreatedAt: nostrTS(clock.Now()),
		Kind:      nostr.KindTextNote,
		Tags:      []nostr.Tag{},
		Content:   "content",
		Sig:       "sig",
	}
	mod(ev)
	return ev
}

func TestShiritoriSifter_basic(t *testing.T) {
	clock.SetFake(time.Unix(fakeNowUnix, 0))

	tests := []struct {
		ev   *nostr.Event
		want evsifter.Action
	}{
		{
			ev:   testEvent(func(ev *nostr.Event) { ev.CreatedAt = nostrTS(clock.Now().Add(time.Hour)) }),
			want: evsifter.ActionShadowReject,
		},
		{
			ev:   testEvent(func(ev *nostr.Event) { ev.CreatedAt = nostrTS(clock.Now().Add(-time.Hour)) }),
			want: evsifter.ActionShadowReject,
		},
		{
			ev:   testEvent(func(ev *nostr.Event) { ev.Kind = nostr.KindReaction }),
			want: evsifter.ActionAccept,
		},
		{
			ev:   testEvent(func(ev *nostr.Event) { ev.Kind = nostr.KindSetMetadata }),
			want: evsifter.ActionShadowReject,
		},
		{
			ev:   testEvent(func(ev *nostr.Event) { ev.Tags = []nostr.Tag{{"e", "", ""}} }),
			want: evsifter.ActionShadowReject,
		},
	}

	for _, tt := range tests {
		input := &evsifter.Input{
			Event: tt.ev,
		}
		result, err := shiritoriSifter(input)
		if err != nil {
			t.Errorf("shiritoriSifter(%v) got unexpected error: %v", tt.ev, err)
		}
		if result.Action != tt.want {
			t.Errorf("shiritoriSifter(%v).Action got %v, want %v", tt.ev, result.Action, tt.want)
		}
	}
}
