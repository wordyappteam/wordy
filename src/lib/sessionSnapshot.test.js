import test from "node:test"
import assert from "node:assert/strict"
import {
  snapshotKey, saveSnapshot, loadSnapshot, clearSnapshot, resumableSnapshot,
} from "./sessionSnapshot.js"

// A minimal stand-in for localStorage. The real one is injected in the app.
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

// A store that throws on every access — private mode / quota exhausted.
const hostileStore = {
  getItem() { throw new Error("nope") },
  setItem() { throw new Error("quota") },
  removeItem() { throw new Error("nope") },
}

const snap = {
  date: "2026-07-28", sessionId: "sess-1", collectionId: null,
  steps: [{ senseId: "a" }, { senseId: "b" }], idx: 1, outcomes: { a: "correct" },
}

test("snapshotKey is namespaced per user and language", () => {
  assert.equal(snapshotKey("u1", "de"), "verba.session.v2:u1:de")
  assert.notEqual(snapshotKey("u1", "de"), snapshotKey("u1", "en"))
  assert.notEqual(snapshotKey("u1", "de"), snapshotKey("u2", "de"))
})

test("save then load round-trips the snapshot", () => {
  const store = fakeStore()
  const key = snapshotKey("u1", "de")
  assert.equal(saveSnapshot(store, key, snap), true)
  assert.deepEqual(loadSnapshot(store, key), snap)
})

test("loadSnapshot returns null when nothing is stored", () => {
  assert.equal(loadSnapshot(fakeStore(), "missing"), null)
})

test("loadSnapshot returns null on a corrupt value instead of throwing", () => {
  const store = fakeStore({ k: "{not json" })
  assert.equal(loadSnapshot(store, "k"), null)
})

test("clearSnapshot removes the entry", () => {
  const store = fakeStore()
  saveSnapshot(store, "k", snap)
  clearSnapshot(store, "k")
  assert.equal(loadSnapshot(store, "k"), null)
})

test("a hostile store never throws — save reports false, load gives null", () => {
  assert.equal(saveSnapshot(hostileStore, "k", snap), false)
  assert.equal(loadSnapshot(hostileStore, "k"), null)
  assert.doesNotThrow(() => clearSnapshot(hostileStore, "k"))
})

test("resumableSnapshot accepts a snapshot from today with a matching collection", () => {
  assert.deepEqual(
    resumableSnapshot(snap, { today: "2026-07-28", collectionId: null }),
    snap,
  )
})

test("resumableSnapshot rejects a snapshot from a previous day", () => {
  // The due set has changed overnight — a stale queue must not be resurrected.
  assert.equal(resumableSnapshot(snap, { today: "2026-07-29", collectionId: null }), null)
})

test("resumableSnapshot rejects a collection mismatch in both directions", () => {
  assert.equal(resumableSnapshot(snap, { today: "2026-07-28", collectionId: "c1" }), null)
  const collectionSnap = { ...snap, collectionId: "c1" }
  assert.equal(resumableSnapshot(collectionSnap, { today: "2026-07-28", collectionId: null }), null)
  assert.deepEqual(
    resumableSnapshot(collectionSnap, { today: "2026-07-28", collectionId: "c1" }),
    collectionSnap,
  )
})

test("resumableSnapshot rejects a finished or out-of-range session", () => {
  const finished = { ...snap, idx: 2 }   // idx === steps.length
  assert.equal(resumableSnapshot(finished, { today: "2026-07-28", collectionId: null }), null)
  const overrun = { ...snap, idx: 5 }
  assert.equal(resumableSnapshot(overrun, { today: "2026-07-28", collectionId: null }), null)
})

test("resumableSnapshot rejects null, and snapshots with no steps", () => {
  assert.equal(resumableSnapshot(null, { today: "2026-07-28", collectionId: null }), null)
  assert.equal(
    resumableSnapshot({ ...snap, steps: [] }, { today: "2026-07-28", collectionId: null }),
    null,
  )
})
