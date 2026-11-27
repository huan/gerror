package main

import (
	"bytes"
	"fmt"
	"os"
	"time"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/durationpb"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "usage: %s <emit|verify> <file>\n", os.Args[0])
		os.Exit(2)
	}
	cmd, path := os.Args[1], os.Args[2]

	switch cmd {
	case "emit":
		if err := emit(path); err != nil {
			fmt.Fprintf(os.Stderr, "emit failed: %v\n", err)
			os.Exit(1)
		}
	case "verify":
		if err := verify(path); err != nil {
			fmt.Fprintf(os.Stderr, "verify failed: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		os.Exit(2)
	}
}

func emit(path string) error {
	errInfoAny, err := anypb.New(&errdetails.ErrorInfo{
		Reason:   "PUPPET_NOT_READY",
		Domain:   "wechaty.dev",
		Metadata: map[string]string{"puppetId": "go-1"},
	})
	if err != nil {
		return err
	}

	retryAny, err := anypb.New(&errdetails.RetryInfo{
		RetryDelay: durationpb.New(3 * time.Second),
	})
	if err != nil {
		return err
	}

	opaqueAny := &anypb.Any{
		TypeUrl: "type.googleapis.com/acme.v1.GoOpaque",
		Value:   []byte{0xde, 0xad, 0xbe, 0xef},
	}

	st := &status.Status{
		Code:    9, // FAILED_PRECONDITION
		Message: "go puppet not ready",
		Details: []*anypb.Any{errInfoAny, retryAny, opaqueAny},
	}

	raw, err := proto.Marshal(st)
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func verify(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var st status.Status
	if err := proto.Unmarshal(raw, &st); err != nil {
		return err
	}

	if st.Code != 9 {
		return fmt.Errorf("expected code 9, got %d", st.Code)
	}
	if st.Message != "ts puppet not ready" {
		return fmt.Errorf("expected message 'ts puppet not ready', got %q", st.Message)
	}

	var foundErrorInfo bool
	var foundOpaque bool
	for _, d := range st.Details {
		if d.TypeUrl == "type.googleapis.com/google.rpc.ErrorInfo" {
			var info errdetails.ErrorInfo
			if err := d.UnmarshalTo(&info); err != nil {
				return err
			}
			if info.Domain == "wechaty.dev" && info.Reason == "PUPPET_NOT_READY" {
				foundErrorInfo = true
			}
		}
		if d.TypeUrl == "type.googleapis.com/acme.v1.TsOpaque" {
			if bytes.Equal(d.Value, []byte{0xca, 0xfe, 0xba, 0xbe}) {
				foundOpaque = true
			}
		}
	}

	if !foundErrorInfo {
		return fmt.Errorf("missing expected ErrorInfo detail")
	}
	if !foundOpaque {
		return fmt.Errorf("missing expected opaque Any detail")
	}
	return nil
}
