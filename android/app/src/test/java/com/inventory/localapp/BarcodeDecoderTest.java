package com.inventory.localapp;

import static org.junit.Assert.*;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import java.util.EnumMap;
import java.util.Map;
import org.junit.Test;

public class BarcodeDecoderTest {
    private Result decode(String text, BarcodeFormat format) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(text, format, 800, 240);
        int width = matrix.getWidth();
        int height = matrix.getHeight();
        int[] pixels = new int[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                pixels[y * width + x] = matrix.get(x, y) ? 0xFF000000 : 0xFFFFFFFF;
            }
        }
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, BarcodeFormats.SUPPORTED);
        return new MultiFormatReader().decode(
            new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels))), hints);
    }

    @Test public void decodesRetailEan13WithoutNumericConversion() throws Exception {
        Result result = decode("6901234567892", BarcodeFormat.EAN_13);
        assertEquals("6901234567892", result.getText());
        assertEquals(BarcodeFormat.EAN_13, result.getBarcodeFormat());
    }

    @Test public void code128KeepsAllLeadingZeros() throws Exception {
        Result result = decode("000012340056", BarcodeFormat.CODE_128);
        assertEquals("000012340056", result.getText());
        assertEquals(BarcodeFormat.CODE_128, result.getBarcodeFormat());
    }

    @Test public void upcAKeepsTwelveDigitsIncludingLeadingZero() throws Exception {
        Result result = decode("012345678905", BarcodeFormat.UPC_A);
        assertEquals("012345678905", result.getText());
        assertEquals(BarcodeFormat.UPC_A, result.getBarcodeFormat());
    }

    @Test public void ean8KeepsLeadingZeros() throws Exception {
        Result result = decode("00012348", BarcodeFormat.EAN_8);
        assertEquals("00012348", result.getText());
        assertEquals(BarcodeFormat.EAN_8, result.getBarcodeFormat());
    }

    @Test public void ean13WithLeadingZeroHasEquivalentUpcARepresentation() throws Exception {
        Result result = decode("0012345678905", BarcodeFormat.EAN_13);
        assertEquals("012345678905", result.getText());
        assertEquals(BarcodeFormat.UPC_A, result.getBarcodeFormat());
    }

    @Test public void supportedFormatsAreOnlyOneDimensional() {
        assertEquals(9, BarcodeFormats.SUPPORTED.size());
        assertTrue(BarcodeFormats.supports("EAN_13"));
        assertTrue(BarcodeFormats.supports("UPC_A"));
        assertFalse(BarcodeFormats.supports("QR_CODE"));
        assertFalse(BarcodeFormats.supports("DATA_MATRIX"));
        assertFalse(BarcodeFormats.supports(null));
        assertFalse(BarcodeFormats.supports("ean_13"));
    }

    @Test public void twoDimensionalCodeIsNotDecoded() throws Exception {
        try {
            decode("6901234567892", BarcodeFormat.QR_CODE);
            fail("QR must not be accepted by the product barcode decoder");
        } catch (NotFoundException expected) {
            // A real generated QR image was rejected by the production format whitelist.
        }
    }
}
