package com.inventory.localapp;

import com.google.zxing.BarcodeFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Shared by the camera decoder and local unit tests. No QR or other 2D formats. */
public final class BarcodeFormats {
    public static final List<BarcodeFormat> SUPPORTED = Collections.unmodifiableList(Arrays.asList(
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
        BarcodeFormat.ITF, BarcodeFormat.CODABAR
    ));

    private BarcodeFormats() {}

    public static boolean supports(String format) {
        if (format == null) return false;
        for (BarcodeFormat supported : SUPPORTED) {
            if (supported.name().equals(format)) return true;
        }
        return false;
    }
}
