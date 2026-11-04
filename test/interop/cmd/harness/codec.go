package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"

	tunnel "interop/internal/tunnelref"
)

// Byte-level comparison of the three CAP1/CAPR codecs: the Go library (cli/pkg/gatewayclient), the gateway's own codec
// (backend/internal/gateway/data/tunnel, copied by gen_tunnelref.sh) and the JS library (run with node). Same inputs, same outputs.

type vecFile struct {
	Vectors []struct {
		Name      string          `json:"name"`
		Hex       string          `json:"hex"`
		EOF       bool            `json:"eof"`
		Canonical bool            `json:"canonical"`
		Expect    json.RawMessage `json:"expect"`
	} `json:"vectors"`
}

type dcase struct {
	Kind string `json:"kind"`
	Hex  string `json:"hex"`
	EOF  bool   `json:"eof"`
	F    *efld  `json:"f,omitempty"`
}

type efld struct {
	Transport byte   `json:"transport"`
	Flags     byte   `json:"flags"`
	Project   string `json:"project"`
	Service   string `json:"service"`
	AuthType  byte   `json:"authType"`
	Auth      string `json:"auth"`
	Nonce     string `json:"nonce,omitempty"`
	ClientID  string `json:"clientId,omitempty"`
	Padding   int    `json:"padding,omitempty"`
}

func normReqGo(b []byte, eof bool) string {
	r, n, err := gw.DecodeRequest(b, eof)
	if err != nil {
		if errors.Is(err, gw.ErrIncomplete) {
			return "incomplete"
		}
		var re *gw.RequestError
		if errors.As(err, &re) {
			return fmt.Sprintf("err %d/0x%04x", re.Status, re.Code)
		}
		return "err other " + err.Error()
	}
	return fmt.Sprintf("ok n=%d t=%d fl=%d p=%s s=%s at=%d a=%s nonce=%x cid=%s ign=%d", n, r.Transport, r.Flags, r.Project, r.Service, r.AuthType, r.Auth, r.Nonce, r.ClientID, r.IgnoredTLVs)
}

func normReqTR(b []byte, eof bool) string {
	r, n, err := tunnel.DecodeRequest(b, eof)
	if err != nil {
		if errors.Is(err, tunnel.ErrIncomplete) {
			return "incomplete"
		}
		var re *tunnel.Error
		if errors.As(err, &re) {
			return fmt.Sprintf("err %d/0x%04x", re.Status, re.Code)
		}
		return "err other " + err.Error()
	}
	return fmt.Sprintf("ok n=%d t=%d fl=%d p=%s s=%s at=%d a=%s nonce=%x cid=%s ign=%d", n, r.Transport, r.Flags, r.Project, r.Service, r.AuthType, r.Auth, r.Nonce, r.ClientID, r.IgnoredTLVs)
}

type jsRes struct {
	R        string `json:"r"`
	Consumed int    `json:"consumed"`
	Status   int    `json:"status"`
	Code     int    `json:"code"`
	Error    string `json:"error"`
	Hex      string `json:"hex"`
	Message  string `json:"message"`
	F        json.RawMessage `json:"f"`
}

type reqF struct {
	Transport int    `json:"transport"`
	Flags     int    `json:"flags"`
	Project   string `json:"project"`
	Service   string `json:"service"`
	AuthType  int    `json:"authType"`
	Auth      string `json:"auth"`
	Ignored   int    `json:"ignored"`
	Nonce     string `json:"nonce"`
	ClientID  string `json:"clientId"`
}

func normReqJS(j jsRes) string {
	switch j.R {
	case "incomplete":
		return "incomplete"
	case "err":
		return fmt.Sprintf("err %d/0x%04x", j.Status, j.Code)
	case "ok":
		var f reqF
		json.Unmarshal(j.F, &f)
		return fmt.Sprintf("ok n=%d t=%d fl=%d p=%s s=%s at=%d a=%s nonce=%s cid=%s ign=%d", j.Consumed, f.Transport, f.Flags, f.Project, f.Service, f.AuthType, f.Auth, f.Nonce, f.ClientID, f.Ignored)
	}
	return "throw " + j.Message
}

func runOracle(cases []dcase) ([]jsRes, error) {
	in := filepath.Join(C.Dir, ".run", "oracle_in.json")
	b, _ := json.Marshal(cases)
	if err := os.WriteFile(in, b, 0o644); err != nil {
		return nil, err
	}
	win, _ := sh("wslpath -w '" + in + "'")
	win = strings.TrimSpace(win)
	var out string
	var code int
	for try := 0; try < 3; try++ {
		out, code = run(cmdOpts{Timeout: 120 * time.Second}, nodeExe, filepath.Join(winDir(), "js", "oracle.mjs"), win)
		if code == 0 {
			break
		}
		time.Sleep(3 * time.Second)
	}
	if code != 0 {
		return nil, fmt.Errorf("oracle node exit %d: %s", code, trunc(out[maxInt(0, len(out)-500):], 500))
	}
	var res []jsRes
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &res); err != nil {
		return nil, fmt.Errorf("oracle output: %v (%s)", err, trunc(out, 200))
	}
	return res, nil
}

func phaseCodec() {
	fmt.Println("== codec: Go lib vs gateway codec vs JS lib, byte for byte")
	rng := rand.New(rand.NewSource(1))
	root := filepath.Join(C.Dir, "..", "..", "docs", "gateway", "testvectors")
	var rv, sv vecFile
	for f, dst := range map[string]*vecFile{"request.json": &rv, "response.json": &sv} {
		b, err := os.ReadFile(filepath.Join(root, f))
		must(err, "read vectors")
		must(json.Unmarshal(b, dst), "parse vectors")
	}

	// ---- request decode cases
	var cases []dcase
	var vIdx []int
	add := func(h string, eof bool) { cases = append(cases, dcase{Kind: "decReq", Hex: h, EOF: eof}) }
	for _, v := range rv.Vectors {
		vIdx = append(vIdx, len(cases))
		add(v.Hex, v.EOF)
		add(v.Hex+"deadbeef", v.EOF) // optimistic data after the header
		raw, _ := hex.DecodeString(v.Hex)
		for i := 0; i < len(raw); i += 1 + len(raw)/40 { // truncations, both eof modes
			add(hex.EncodeToString(raw[:i]), false)
			add(hex.EncodeToString(raw[:i]), true)
		}
		for k := 0; k < 40 && len(raw) > 0; k++ { // single and double byte mutations
			m := append([]byte{}, raw...)
			m[rng.Intn(len(m))] = byte(rng.Intn(256))
			if k%2 == 0 {
				m[rng.Intn(len(m))] ^= byte(1 << uint(rng.Intn(8)))
			}
			add(hex.EncodeToString(m), true)
		}
	}
	nReqDec := len(cases)
	// ---- request encode cases
	names := func() string {
		n := 1 + rng.Intn(63)
		b := make([]byte, n)
		const al = "abcdefghijklmnopqrstuvwxyz0123456789-"
		for i := range b {
			b[i] = al[rng.Intn(len(al))]
		}
		b[0] = al[rng.Intn(36)]
		b[n-1] = al[rng.Intn(36)]
		return string(b)
	}
	prefixes := []string{"", "cap_", "cgt_", "cgc_", "cgs_"}
	for i := 0; i < 600; i++ {
		at := byte(1 + rng.Intn(4))
		al := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-"
		tl := 4 + rng.Intn(60)
		if i%7 == 0 {
			tl = 505 + rng.Intn(8) // around the 512 limit
		}
		tok := []byte(prefixes[at])
		for len(tok) < tl {
			tok = append(tok, al[rng.Intn(len(al))])
		}
		f := &efld{Transport: byte(1 + rng.Intn(3)), Flags: byte(rng.Intn(2)), Project: names(), Service: names(), AuthType: at, Auth: string(tok)}
		if rng.Intn(2) == 0 {
			n := make([]byte, 16)
			rng.Read(n)
			f.Nonce = hex.EncodeToString(n)
		}
		if rng.Intn(2) == 0 {
			f.ClientID = "capsule-test/" + fmt.Sprint(rng.Intn(100))
		}
		if rng.Intn(3) == 0 {
			f.Padding = rng.Intn(256)
		}
		cases = append(cases, dcase{Kind: "encReq", F: f})
	}
	js, err := runOracle(cases)
	if err != nil {
		check("codec", "oracle", "js oracle", "-", "-", "runs", err.Error(), false, "")
		return
	}
	mis, misRef := 0, 0
	var ex []string
	for i, c := range cases[:nReqDec] {
		b, _ := hex.DecodeString(c.Hex)
		g, t, j := normReqGo(b, c.EOF), normReqTR(b, c.EOF), normReqJS(js[i])
		if g != t || g != j {
			mis++
			if len(ex) < 4 {
				ex = append(ex, fmt.Sprintf("hex=%s eof=%v | go=%q gw=%q js=%q", trunc(c.Hex, 60), c.EOF, trunc(g, 60), trunc(t, 60), trunc(j, 60)))
			}
		}
	}
	check("codec", "req-decode", "Go lib=gateway=JS", "-", "-", fmt.Sprintf("%d cases, identical outcome", nReqDec), fmt.Sprintf("%d differ", mis), mis == 0, strings.Join(ex, " ## "))

	// vectors against their documented expectation, per implementation
	bad := map[string]int{}
	var badEx []string
	idx := 0
	_ = idx
	for vi, v := range rv.Vectors {
		var exp struct {
			OK       bool   `json:"ok"`
			Status   int    `json:"status"`
			Code     string `json:"code"`
			Consumed int    `json:"consumed"`
			Inc      bool   `json:"incomplete"`
		}
		json.Unmarshal(v.Expect, &exp)
		raw, _ := hex.DecodeString(v.Hex)
		want := ""
		switch {
		case exp.Inc:
			want = "incomplete"
		case !exp.OK:
			want = fmt.Sprintf("err %d/%s", exp.Status, strings.ToLower(exp.Code))
		default:
			want = fmt.Sprintf("ok n=%d", exp.Consumed)
		}
		for name, got := range map[string]string{"go": normReqGo(raw, v.EOF), "gateway": normReqTR(raw, v.EOF), "js": normReqJS(js[vIdx[vi]])} {
			if !strings.HasPrefix(got, want) {
				bad[name]++
				badEx = append(badEx, fmt.Sprintf("%s:%s want %q got %q", name, v.Name, want, trunc(got, 40)))
			}
		}
	}
	_ = misRef
	check("codec", "req-vectors", "Go lib / gateway / JS", "-", "-", fmt.Sprintf("%d vectors = documented result", len(rv.Vectors)), fmt.Sprintf("go=%d gateway=%d js=%d mismatches", bad["go"], bad["gateway"], bad["js"]), len(bad) == 0, strings.Join(firstN(badEx, 4), " ## "))

	// encode
	encMis, encErr := 0, 0
	var encEx []string
	for i, c := range cases[nReqDec:] {
		f := c.F
		var nonce []byte
		if f.Nonce != "" {
			nonce, _ = hex.DecodeString(f.Nonce)
		}
		gb, gerr := gw.EncodeRequest(gw.Request{Flags: f.Flags, Transport: f.Transport, Project: f.Project, Service: f.Service, AuthType: f.AuthType, Auth: f.Auth, Nonce: nonce, ClientID: f.ClientID, Padding: f.Padding})
		tb, terr := tunnel.EncodeRequest(&tunnel.Request{Flags: f.Flags, Transport: f.Transport, Project: f.Project, Service: f.Service, AuthType: f.AuthType, Auth: f.Auth, Nonce: nonce, ClientID: f.ClientID, Padding: f.Padding})
		j := js[nReqDec+i]
		gs, ts, jsr := "err", "err", "err"
		if gerr == nil {
			gs = hex.EncodeToString(gb)
		}
		if terr == nil {
			ts = hex.EncodeToString(tb)
		}
		if j.R == "ok" {
			jsr = j.Hex
		}
		if gs == "err" {
			encErr++
		}
		if gs != ts || gs != jsr {
			encMis++
			if len(encEx) < 4 {
				encEx = append(encEx, fmt.Sprintf("t=%d pad=%d tokLen=%d proj=%d svc=%d nonce=%v cid=%d go=%s(%v) gw=%s(%v) js=%s(%s)", f.Transport, f.Padding, len(f.Auth), len(f.Project), len(f.Service), f.Nonce != "", len(f.ClientID), trunc(gs, 16), gerr, trunc(ts, 16), terr, trunc(jsr, 16), j.Message))
			}
		}
	}
	check("codec", "req-encode", "Go lib=gateway=JS", "-", "-", "600 random valid/edge requests encode to the same bytes", fmt.Sprintf("%d differ (%d rejected by all)", encMis, encErr), encMis == 0, strings.Join(encEx, " ## "))

	codecBigPadding()
	// ---- response decode (Go lib vs gateway codec vs JS)
	var rc []dcase
	for _, v := range sv.Vectors {
		rc = append(rc, dcase{Kind: "decResp", Hex: v.Hex, EOF: v.EOF}, dcase{Kind: "decResp", Hex: v.Hex + "00ff", EOF: v.EOF})
		raw, _ := hex.DecodeString(v.Hex)
		for i := 0; i < len(raw); i++ {
			rc = append(rc, dcase{Kind: "decResp", Hex: hex.EncodeToString(raw[:i]), EOF: i%2 == 0})
		}
		for k := 0; k < 40 && len(raw) > 0; k++ {
			m := append([]byte{}, raw...)
			m[rng.Intn(len(m))] = byte(rng.Intn(256))
			rc = append(rc, dcase{Kind: "decResp", Hex: hex.EncodeToString(m), EOF: true})
		}
	}
	jr, err := runOracle(rc)
	if err != nil {
		check("codec", "resp-oracle", "js oracle", "-", "-", "runs", err.Error(), false, "")
		return
	}
	rmis := 0
	var rex []string
	for i, c := range rc {
		raw, _ := hex.DecodeString(c.Hex)
		g, t, j := normRespGo(raw, c.EOF), normRespTR(raw, c.EOF), normRespJS(jr[i])
		if g != t || g != j {
			rmis++
			if len(rex) < 4 {
				rex = append(rex, fmt.Sprintf("hex=%s eof=%v | go=%q gw=%q js=%q", trunc(c.Hex, 50), c.EOF, trunc(g, 50), trunc(t, 50), trunc(j, 50)))
			}
		}
	}
	check("codec", "resp-decode", "Go lib=gateway=JS", "-", "-", fmt.Sprintf("%d cases, identical outcome", len(rc)), fmt.Sprintf("%d differ", rmis), rmis == 0, strings.Join(rex, " ## "))
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func firstN(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func respStr(status byte, code uint16, ver byte, msg string, mv *byte, ra *uint16, sid []byte, ca string, md, it *uint16, n int) string {
	p := func(v *uint16) string {
		if v == nil {
			return "-"
		}
		return fmt.Sprint(*v)
	}
	m := "-"
	if mv != nil {
		m = fmt.Sprint(*mv)
	}
	return fmt.Sprintf("ok n=%d v=%d st=%d code=%d msg=%q mv=%s ra=%s sid=%x ca=%s md=%s it=%s", n, ver, status, code, msg, m, p(ra), sid, ca, p(md), p(it))
}

func normRespGo(b []byte, eof bool) string {
	r, n, err := gw.DecodeResponse(b, eof)
	if err != nil {
		if errors.Is(err, gw.ErrIncomplete) {
			return "incomplete"
		}
		var pe *gw.ProtocolError
		if errors.As(err, &pe) {
			return "err " + pe.Kind
		}
		return "err other"
	}
	ca := "-"
	if r.TLVs.ClientAddr != nil {
		ca = fmt.Sprintf("%s/%d", r.TLVs.ClientAddr.Addr, r.TLVs.ClientAddr.Port)
	}
	return respStr(r.Status, r.Code, r.Version, r.Msg, r.TLVs.MaxVersion, r.TLVs.RetryAfter, r.TLVs.SessionID, ca, r.TLVs.MaxDatagram, r.TLVs.IdleTimeout, n)
}

func normRespTR(b []byte, eof bool) string {
	r, n, err := tunnel.DecodeResponse(b, eof)
	if err != nil {
		if errors.Is(err, tunnel.ErrIncompleteResponse) {
			return "incomplete"
		}
		var re tunnel.ResponseError
		if errors.As(err, &re) {
			return "err " + string(re)
		}
		return "err other"
	}
	ca := "-"
	if r.ClientAddr != nil {
		ca = fmt.Sprintf("%s/%d", r.ClientAddr.Addr, r.ClientAddr.Port)
	}
	return respStr(r.Status, r.Code, r.Version, r.Msg, r.MaxVersion, r.RetryAfter, r.SessionID, ca, r.MaxDatagram, r.IdleTimeout, n)
}

func normRespJS(j jsRes) string {
	switch j.R {
	case "incomplete":
		return "incomplete"
	case "err":
		return "err " + j.Error
	case "ok":
		var f struct {
			Version     int    `json:"version"`
			Status      int    `json:"status"`
			Code        int    `json:"code"`
			Msg         string `json:"msg"`
			MaxVersion  *int   `json:"maxVersion"`
			RetryAfter  *int   `json:"retryAfter"`
			SessionID   string `json:"sessionId"`
			ClientAddr  *struct {
				IP   string `json:"ip"`
				Port int    `json:"port"`
			} `json:"clientAddr"`
			MaxDatagram *int `json:"maxDatagram"`
			IdleTimeout *int `json:"idleTimeout"`
		}
		json.Unmarshal(j.F, &f)
		ip := func(v *int) string {
			if v == nil {
				return "-"
			}
			return fmt.Sprint(*v)
		}
		ca := "-"
		if f.ClientAddr != nil {
			ca = fmt.Sprintf("%s/%d", f.ClientAddr.IP, f.ClientAddr.Port)
		}
		return fmt.Sprintf("ok n=%d v=%d st=%d code=%d msg=%q mv=%s ra=%s sid=%s ca=%s md=%s it=%s", j.Consumed, f.Version, f.Status, f.Code, f.Msg, ip(f.MaxVersion), ip(f.RetryAfter), f.SessionID, ca, ip(f.MaxDatagram), ip(f.IdleTimeout))
	}
	return "throw " + j.Message
}

// padding beyond 255 bytes: the Go library splits it over several 0x80 TLVs, the JS library and the gateway's reference encoder
// refuse it. The wire stays interoperable (every decoder accepts the result); the difference is API-level and is reported.
func codecBigPadding() {
	var cs []dcase
	var hexes []string
	for pad := 256; pad <= 640; pad += 24 {
		b, err := gw.EncodeRequest(gw.Request{Transport: 1, Project: "shop", Service: "pg", AuthType: 1, Auth: "cap_" + strings.Repeat("a", 40), Padding: pad})
		if err != nil {
			continue
		}
		hexes = append(hexes, hex.EncodeToString(b))
		cs = append(cs, dcase{Kind: "decReq", Hex: hex.EncodeToString(b), EOF: true})
	}
	if len(cs) == 0 {
		_, ge := gw.EncodeRequest(gw.Request{Transport: 1, Project: "shop", Service: "pg", AuthType: 1, Auth: "cap_" + strings.Repeat("a", 40), Padding: 300})
		check("codec", "big-padding", "Go lib", "-", "-", "Padding > 255 rejected like the JS library and the gateway encoder (H5 fixed)", errStr(ge), ge != nil, "")
		return
	}
	js, err := runOracle(cs)
	if err != nil {
		check("codec", "big-padding", "JS oracle", "-", "-", "runs", err.Error(), false, "")
		return
	}
	bad := 0
	for i, h := range hexes {
		raw, _ := hex.DecodeString(h)
		if normReqGo(raw, true) != normReqTR(raw, true) || normReqTR(raw, true) != normReqJS(js[i]) || !strings.HasPrefix(normReqTR(raw, true), "ok") {
			bad++
		}
	}
	_, terr := tunnel.EncodeRequest(&tunnel.Request{Transport: 1, Project: "shop", Service: "pg", AuthType: 1, Auth: "cap_" + strings.Repeat("a", 40), Padding: 300})
	check("codec", "big-padding", "Go lib -> gateway/JS decoders", "-", "-", "padding 256..640 sent by the Go lib is decoded identically", fmt.Sprintf("%d of %d differ; gateway encoder on 300: %v", bad, len(hexes), terr), bad == 0,
		"API difference (not wire): Go EncodeRequest accepts Padding>255 (several TLVs), JS encodeRequest and the gateway reference encoder reject it")
}
