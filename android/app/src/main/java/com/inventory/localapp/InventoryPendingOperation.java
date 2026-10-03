package com.inventory.localapp;

/** Identity-based operation ownership. Stale callbacks cannot finish a newer call. */
final class InventoryPendingOperation<T> {
    private T pending;
    private boolean launched, resultClaimed, destroyed, restoredConsumed, started;

    synchronized boolean begin(T call) {
        if (destroyed || pending != null || call == null) return false;
        pending = call; launched = false; resultClaimed = false; started = true;
        return true;
    }
    synchronized boolean isCurrent(T call) { return !destroyed && call != null && pending == call; }
    synchronized T current() { return pending; }
    synchronized boolean isDestroyed() { return destroyed; }
    synchronized boolean claimLaunch(T call) {
        if (!isCurrent(call) || launched) return false;
        launched = true; return true;
    }
    synchronized boolean claimResult(T call) {
        if (!isCurrent(call) || !launched || resultClaimed) return false;
        resultClaimed = true; return true;
    }
    synchronized boolean finish(T call) {
        if (!isCurrent(call)) return false;
        pending = null; return true;
    }
    synchronized boolean finishResult(T call, boolean restored) {
        if (destroyed || call == null) return false;
        if (isCurrent(call)) return claimResult(call) && finish(call);
        // Capacitor can deliver a dangling camera result after process recreation.
        if (pending == null && !started && restored && !restoredConsumed) {
            restoredConsumed = true; return true;
        }
        return false;
    }
    synchronized T destroy() {
        destroyed = true; T call = pending; pending = null; return call;
    }
}
