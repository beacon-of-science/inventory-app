package com.inventory.localapp;
import org.junit.Test;
import static org.junit.Assert.*;
public class CameraOperationGateTest {
    @Test public void onlyOwnerCanReleaseCamera() {
        Object scan=new Object(),ocr=new Object();
        try {assertTrue(CameraOperationGate.acquire(scan));assertFalse(CameraOperationGate.acquire(ocr));CameraOperationGate.release(ocr);assertFalse(CameraOperationGate.acquire(ocr));CameraOperationGate.release(scan);assertTrue(CameraOperationGate.acquire(ocr));}
        finally {CameraOperationGate.release(scan);CameraOperationGate.release(ocr);}
    }
}
