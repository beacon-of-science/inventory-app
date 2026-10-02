package com.inventory.localapp;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.Test;

public class InventoryFileCodecTest {
    @Test public void utf8RoundTripPreservesChineseEmojiAndLeadingZeros() throws Exception {
        String value = "{\"name\":\"收纳盒📦\",\"barcode\":\"00123\"}";
        assertEquals(value, InventoryFileCodec.read(new ByteArrayInputStream(InventoryFileCodec.encode(value))));
    }
    @Test public void exactByteLimitIsAllowed() throws Exception {
        byte[] bytes = new byte[InventoryFileCodec.MAX_BYTES]; Arrays.fill(bytes, (byte) 'a');
        String value = InventoryFileCodec.read(new ByteArrayInputStream(bytes));
        assertEquals(InventoryFileCodec.MAX_BYTES, value.length());
        assertEquals(InventoryFileCodec.MAX_BYTES, InventoryFileCodec.encode(value).length);
    }
    @Test public void streamingLimitRejectsOversizedInputEvenWithoutMetadata() throws Exception {
        byte[] bytes = new byte[InventoryFileCodec.MAX_BYTES + 1]; Arrays.fill(bytes, (byte) 'a');
        try { InventoryFileCodec.read(new ByteArrayInputStream(bytes)); fail("oversized input accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("5 MiB")); }
    }
    @Test public void multibyteExportLimitUsesBytesNotCharacters() throws Exception {
        char[] chars = new char[InventoryFileCodec.MAX_BYTES / 3 + 1]; Arrays.fill(chars, '中');
        try { InventoryFileCodec.encode(new String(chars)); fail("oversized UTF8 accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("5 MiB")); }
    }
    @Test public void malformedUtf8IsRejectedRatherThanSilentlyReplaced() throws Exception {
        try { InventoryFileCodec.read(new ByteArrayInputStream(new byte[] {(byte) 0xC3, 0x28})); fail("malformed input accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("UTF-8")); }
    }
    @Test public void unpairedSurrogateCannotBeExported() throws Exception {
        try { InventoryFileCodec.encode("\uD800"); fail("malformed string accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("UTF-8")); }
    }
    @Test public void readIoFailureIsPropagated() throws Exception {
        InputStream broken = new InputStream() {
            public int read() throws IOException { throw new IOException("simulated read failure"); }
        };
        try { InventoryFileCodec.read(broken); fail("IO error swallowed"); }
        catch (IOException expected) { assertEquals("simulated read failure", expected.getMessage()); }
    }
}
