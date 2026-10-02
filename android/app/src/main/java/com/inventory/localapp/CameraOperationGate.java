package com.inventory.localapp;
/** Protects camera activities across scanner and packaging OCR plugins. */
public final class CameraOperationGate {
    private static Object owner;
    private CameraOperationGate() {}
    public static synchronized boolean acquire(Object requester) { if(owner!=null)return false;owner=requester;return true; }
    public static synchronized void release(Object requester) { if(owner==requester)owner=null; }
}
