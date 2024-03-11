package main

import (
	"errors"
	"log"
	"os"
	"sync"
	"syscall"
)

type fileLock struct {
	l sync.Mutex
	f *os.File
}

func openFileWithLock(filename string, param int, flag os.FileMode) (*fileLock, error) {
	if filename == "" {
		return nil, errors.New("NewFileLock: filename needed")
	}
	f, err := os.OpenFile(filename, param, flag)
	if err != nil {
		return nil, err
	}
	return &fileLock{f: f}, nil
}

func (m *fileLock) lock() error {
	log.Printf("FileLock.Lock: acquiring lock of %q", m.f.Name())
	m.l.Lock()
	if err := syscall.Flock(int(m.f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	log.Printf("FileLock.Lock: acquired lock of %q", m.f.Name())
	return nil
}

func (m *fileLock) unlock() error {
	log.Printf("FileLock.Unlock: releasing lock of %q", m.f.Name())
	if err := syscall.Flock(int(m.f.Fd()), syscall.LOCK_UN); err != nil {
		return err
	}
	m.l.Unlock()
	log.Printf("FileLock.Unlock: released lock of %q", m.f.Name())
	return nil
}
