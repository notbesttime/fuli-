package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestGenerateAPIKeySecretHasHighEntropy(t *testing.T) {
	first, err := generateAPIKeySecret()
	if err != nil {
		t.Fatal(err)
	}
	second, err := generateAPIKeySecret()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(first, "sk-fuli-") || len(first) != len("sk-fuli-")+43 {
		t.Fatalf("unexpected key format or entropy length: %q", first)
	}
	if first == second {
		t.Fatal("generated API keys must be unique")
	}
}

func TestHashAPIKeySecretUsesSHA256(t *testing.T) {
	expected := sha256.Sum256([]byte("test"))
	want := hex.EncodeToString(expected[:])
	if got := hashAPIKeySecret("test"); got != want {
		t.Fatalf("hashAPIKeySecret(test)=%q, want %q", got, want)
	}
}

func TestAPIKeySummaryNeverSerializesSecretOrHash(t *testing.T) {
	key := model.APIKey{ID: "id", Name: "test", Prefix: "sk-fuli-abcd", KeyHash: "hash-value", Group: "default", Active: true, CreatedAt: "now"}
	payload, err := json.Marshal(key.Summary())
	if err != nil {
		t.Fatal(err)
	}
	body := string(payload)
	for _, forbidden := range []string{"secret", "hash", "hash-value"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("summary contains forbidden value %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, "default") || !strings.Contains(body, "sk-fuli-abcd") {
		t.Fatalf("summary is missing safe metadata: %s", body)
	}
}
