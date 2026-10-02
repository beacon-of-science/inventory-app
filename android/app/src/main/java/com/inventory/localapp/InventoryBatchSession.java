package com.inventory.localapp;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Pure state: observations never add ordinary inventory quantities. */
public final class InventoryBatchSession {
    public final String mode;
    public final String barcode;
    private final ArrayList<String> confirmed = new ArrayList<>();
    private final LinkedHashSet<String> unique = new LinkedHashSet<>();
    public InventoryBatchSession(String mode, String barcode) { this.mode = mode; this.barcode = barcode; }
    public static boolean validCode(String value, int max) {
        if (value == null || value.trim().isEmpty() || value.length() > max) return false;
        for (int i=0;i<value.length();i++) if (value.charAt(i)<32 || value.charAt(i)>126) return false;
        return true;
    }
    public boolean observeUnique(String code) { return mode.equals("unique") && validCode(code,120) && unique.size()<10000 && unique.add(code); }
    public static boolean skuMatches(String stored, String value, String decodedFormat) {
        if(stored.equals(value))return true;
        if("UPC_A".equals(decodedFormat) && value.matches("[0-9]{12}")) return stored.equals("0"+value);
        if("EAN_13".equals(decodedFormat) && value.matches("0[0-9]{12}")) return stored.equals(value.substring(1));
        return false;
    }
    public boolean matchesOrdinary(String value,String decodedFormat,String expectedFormat) {
        if(decodedFormat==null || !skuMatches(barcode,value,decodedFormat))return false;
        if(expectedFormat==null || expectedFormat.equals(decodedFormat))return true;
        return ("UPC_A".equals(expectedFormat) && "EAN_13".equals(decodedFormat) && value.matches("0[0-9]{12}")) ||
               ("EAN_13".equals(expectedFormat) && "UPC_A".equals(decodedFormat) && value.matches("[0-9]{12}"));
    }
    public boolean observeScannedUnique(String code,String decodedFormat) { return !skuMatches(barcode,code,decodedFormat) && observeUnique(code); }
    public void confirmSingle() { if (mode.equals("single") && confirmed.size()<10000) confirmed.add(barcode); }
    public List<String> codes() { return new ArrayList<>(mode.equals("unique") ? unique : confirmed); }
    public void restore(List<String> codes) { for (String code : codes) { if (mode.equals("unique")) observeUnique(code); else if (barcode.equals(code)) confirmSingle(); } }
}
