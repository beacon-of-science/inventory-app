package com.inventory.localapp;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Byte-based limits protect against oversized and malformed external backup files. */
public final class InventoryFileCodec {
    public static final int MAX_BYTES = 5 * 1024 * 1024;
    private InventoryFileCodec() {}

    public static byte[] encode(String content) throws IOException {
        if (content == null) throw new IOException("文件内容无效");
        if (content.length() > MAX_BYTES) throw new IOException("文件不能超过 5 MiB");
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .encode(java.nio.CharBuffer.wrap(content));
            if (encoded.remaining() > MAX_BYTES) throw new IOException("文件不能超过 5 MiB");
            byte[] result = new byte[encoded.remaining()];
            encoded.get(result);
            return result;
        } catch (CharacterCodingException exception) {
            throw new IOException("文件包含无效文本，请使用 UTF-8 JSON 文件", exception);
        }
    }

    public static String read(InputStream stream) throws IOException {
        if (stream == null) throw new IOException("无法读取所选文件");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("文件操作已中断，请重试");
            if (bytes.size() + count > MAX_BYTES) throw new IOException("文件不能超过 5 MiB");
            bytes.write(buffer, 0, count);
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException exception) {
            throw new IOException("文件不是有效的 UTF-8 文本，请选择 JSON 备份文件", exception);
        }
    }
}
