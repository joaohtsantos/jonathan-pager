// Go test-vector generator for the TypeScript comms client.
//
// Regenerate go-vectors.json (from a scratch copy of ~/fun/comms, never the live checkout):
//   git -C ~/fun/comms archive feat/joao/porter-v2 | tar -x -C $SCRATCH/comms-src
//   mkdir -p $SCRATCH/comms-src/cmd/vectors && cp main.go $SCRATCH/comms-src/cmd/vectors/
//   (cd $SCRATCH/comms-src && go build -o $SCRATCH/vectors ./cmd/vectors)
//   $SCRATCH/vectors > ../go-vectors.json
// `vectors verify` (stdin JSON) opens a TS-made envelope with the real comms.Decrypt;
// envelope.test.ts uses it when COMMS_VECTORS_BIN=$SCRATCH/vectors is set.
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/joaohts/comms/internal/comms"
	"github.com/joaohts/comms/internal/porter"
	"golang.org/x/crypto/nacl/box"
)

func key(seed byte) (pub, priv *[32]byte) {
	b := bytes.Repeat([]byte{seed}, 32)
	pub, priv, _ = box.GenerateKey(bytes.NewReader(b))
	return
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func main() {
	if len(os.Args) > 1 && os.Args[1] == "verify" {
		verify()
		return
	}
	aPub, aPriv := key(1) // phone
	bPub, bPriv := key(2) // machine
	phone := comms.Identity{MachineID: "m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PublicKey: aPub[:], PrivateKey: aPriv[:]}
	mac := comms.Identity{MachineID: "m_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", PublicKey: bPub[:], PrivateKey: bPriv[:]}
	phonePeer := comms.Peer{MachineID: phone.MachineID, PublicKey: phone.PublicKey}
	macPeer := comms.Peer{MachineID: mac.MachineID, PublicKey: mac.PublicKey}
	const exp = int64(1791000000000)
	const created = int64(1790900000000)
	var nonce [24]byte
	for i := range nonce {
		nonce[i] = byte(i + 7)
	}
	body := `{"type":"porter.subscribe","v":1,"topics":["agents"],"note":"<a&b> ção 🚀\n "}`
	// Phone -> mac message with a fixed nonce: TS must produce identical bytes.
	msg := comms.Payload{Routing: comms.Routing{Version: 1, ID: "msg_00112233445566778899aabbccddeeff", Sender: phone.MachineID, Recipient: mac.MachineID, Kind: "message", ExpiresAt: exp},
		SenderAgent: "a_11111111111111111111111111111111", RecipientAgent: "a_22222222222222222222222222222222", CreatedAt: created, Body: body}
	msgPlain, _ := json.Marshal(msg)
	msgEnv := comms.Envelope{Routing: msg.Routing, Nonce: nonce[:], Ciphertext: box.Seal(nil, msgPlain, &nonce, bPub, aPriv)}
	msgWire, _ := json.Marshal(msgEnv)
	// Phone -> mac receipt with the same fixed nonce.
	rid := "r_" + func() string { h := sha256.Sum256([]byte(mac.MachineID + "/msg_x1/handed_off")); return hex.EncodeToString(h[:]) }()[:32]
	rc := comms.Payload{Routing: comms.Routing{Version: 1, ID: rid, Sender: phone.MachineID, Recipient: mac.MachineID, Kind: "receipt", ExpiresAt: exp},
		SenderAgent: "a_11111111111111111111111111111111", RecipientAgent: "a_22222222222222222222222222222222", CreatedAt: created, Receipt: &comms.Receipt{OriginalID: "msg_x1", Status: "handed_off", At: created}}
	rcPlain, _ := json.Marshal(rc)
	rcEnv := comms.Envelope{Routing: rc.Routing, Nonce: nonce[:], Ciphertext: box.Seal(nil, rcPlain, &nonce, bPub, aPriv)}
	rcWire, _ := json.Marshal(rcEnv)
	// Mac -> phone message via the real Encrypt (random nonce); TS must open it.
	in := comms.Payload{Routing: comms.Routing{Version: 1, ID: "msg_ffeeddccbbaa99887766554433221100", Sender: mac.MachineID, Recipient: phone.MachineID, Kind: "message", ExpiresAt: exp},
		SenderAgent: "a_22222222222222222222222222222222", RecipientAgent: "a_11111111111111111111111111111111", CreatedAt: created, Body: `{"type":"porter.subscribed","v":1,"machine":"mac","note":"olá <b>"}`}
	inEnv, e := comms.Encrypt(mac, phonePeer, in)
	must(e)
	inWire, _ := json.Marshal(inEnv)
	_ = macPeer
	// Anonymous sealed box (broker auth challenge) to the phone.
	chal := map[string]any{"purpose": "comms-auth-v1", "id": "c_0123", "machine_id": phone.MachineID, "public_key": phone.PublicKey, "secret": "s3cr3t-s3cr3t-s3cr3t-s3cr3t-s3cr3t-00", "expires_at": exp}
	chalPlain, _ := json.Marshal(chal)
	sealed, e := box.SealAnonymous(nil, chalPlain, aPub, rand.Reader)
	must(e)
	// Encrypted push from mac to phone.
	push, e := porter.PushData(porter.Notice{Machine: "mac", Agent: "sess-1", Title: "pager-refactor", Status: "needs_you", Needs: &porter.Needs{Kind: "permission", Text: "Bash: npm install"}}, mac.MachineID, aPub[:], bPriv[:])
	must(e)
	out := map[string]any{
		"phone":            map[string]string{"machine_id": phone.MachineID, "public_key": b64(aPub[:]), "private_key": b64(aPriv[:])},
		"mac":              map[string]string{"machine_id": mac.MachineID, "public_key": b64(bPub[:]), "private_key": b64(bPriv[:])},
		"nonce":            b64(nonce[:]),
		"message_payload":  string(msgPlain),
		"message_envelope": string(msgWire),
		"receipt_id":       rid,
		"receipt_payload":  string(rcPlain),
		"receipt_envelope": string(rcWire),
		"incoming_envelope": string(inWire),
		"incoming_payload": string(func() []byte { b, _ := json.Marshal(in); return b }()),
		"challenge_sealed": b64(sealed),
		"challenge_plain":  string(chalPlain),
		"push":             push,
		"now":              created,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(out))
}

// verify reads {"recipient_private_key","recipient_machine_id","sender_public_key","sender_machine_id","envelope":{...}}
// on stdin and opens it with the real comms.Decrypt.
func verify() {
	var in struct {
		RecipientPriv []byte          `json:"recipient_private_key"`
		RecipientPub  []byte          `json:"recipient_public_key"`
		RecipientID   string          `json:"recipient_machine_id"`
		SenderPub     []byte          `json:"sender_public_key"`
		SenderID      string          `json:"sender_machine_id"`
		Envelope      json.RawMessage `json:"envelope"`
	}
	must(json.NewDecoder(os.Stdin).Decode(&in))
	var env comms.Envelope
	must(json.Unmarshal(in.Envelope, &env))
	p, e := comms.Decrypt(comms.Identity{MachineID: in.RecipientID, PublicKey: in.RecipientPub, PrivateKey: in.RecipientPriv}, comms.Peer{MachineID: in.SenderID, PublicKey: in.SenderPub}, env)
	if e != nil {
		fmt.Println(`{"ok":false,"error":` + string(func() []byte { b, _ := json.Marshal(e.Error()); return b }()) + `}`)
		return
	}
	b, _ := json.Marshal(map[string]any{"ok": true, "payload": p})
	fmt.Println(string(b))
}
