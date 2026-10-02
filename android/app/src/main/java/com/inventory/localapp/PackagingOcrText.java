package com.inventory.localapp;
public final class PackagingOcrText {
    private PackagingOcrText() {}
    public static boolean valid(String text) { return text!=null && !text.trim().isEmpty() && text.length()<=4000; }
    public static String limit(String text) {
        if(text==null)return "";
        if(text.length()<=4000)return text;
        int end=4000;
        if(Character.isHighSurrogate(text.charAt(end-1)) && Character.isLowSurrogate(text.charAt(end)))end--;
        return text.substring(0,end);
    }
}
