package com.inventory.localapp;
import org.junit.Test;
import static org.junit.Assert.*;

public class InventoryPendingOperationTest {
    @Test public void duplicateResultCannotFinishNewOperation() {
        InventoryPendingOperation<Object> operations = new InventoryPendingOperation<>();
        Object old = new Object(), next = new Object();
        assertTrue(operations.begin(old)); assertFalse(operations.begin(next));
        assertTrue(operations.claimLaunch(old)); assertFalse(operations.claimLaunch(old));
        assertTrue(operations.finishResult(old, false)); assertFalse(operations.finishResult(old, false));
        assertTrue(operations.begin(next)); assertTrue(operations.claimLaunch(next));
        assertFalse(operations.finishResult(old, false)); assertTrue(operations.isCurrent(next));
        assertTrue(operations.finishResult(next, false));
        assertFalse(operations.finishResult(old, true));
    }
    @Test public void duplicateFileCallbackDoesNotRunIoAgain() {
        InventoryPendingOperation<Object> operations = new InventoryPendingOperation<>(); Object call = new Object();
        assertTrue(operations.begin(call)); assertFalse(operations.claimResult(call));
        assertTrue(operations.claimLaunch(call)); assertTrue(operations.claimResult(call));
        assertFalse(operations.claimResult(call)); assertTrue(operations.finish(call)); assertFalse(operations.finish(call));
    }
    @Test public void destructionRejectsLateCallbacksAndPermissionLaunch() {
        InventoryPendingOperation<Object> operations = new InventoryPendingOperation<>(); Object call = new Object();
        assertTrue(operations.begin(call)); assertSame(call, operations.destroy()); assertTrue(operations.isDestroyed());
        assertFalse(operations.claimLaunch(call)); assertFalse(operations.finishResult(call, true)); assertFalse(operations.begin(new Object()));
        assertNull(operations.destroy());
    }
    @Test public void restoredCameraResultIsDeliveredOnceWithoutAffectingNewCall() {
        InventoryPendingOperation<Object> operations = new InventoryPendingOperation<>(); Object restored = new Object(), next = new Object();
        assertFalse(operations.finishResult(restored, false)); assertTrue(operations.finishResult(restored, true));
        assertFalse(operations.finishResult(restored, true)); assertTrue(operations.begin(next));
        assertFalse(operations.finishResult(restored, true)); assertTrue(operations.isCurrent(next));
    }
}
