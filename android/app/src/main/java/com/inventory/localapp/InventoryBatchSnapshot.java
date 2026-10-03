package com.inventory.localapp;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;

/** Small saved-state tokens refer to bounded, verified snapshots in app-private cache. */
final class InventoryBatchSnapshot {
    static final String DIRECTORY = "inventory-batch-snapshots";
    static final int MAX_BYTES = 1_300_000;
    static final int MAX_SNAPSHOTS = 8;
    private static final int MAGIC = 0x49425331;
    private static final String TOKEN = "[a-f0-9]{32}";
    private InventoryBatchSnapshot() {}

    static String save(File directory, String mode, String barcode, List<String> codes) throws IOException {
        validate(mode, barcode, codes);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法保存扫码批次");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream data = new DataOutputStream(bytes)) {
            data.writeInt(MAGIC); data.writeUTF(mode); data.writeUTF(barcode); data.writeInt(codes.size());
            for (String code : codes) data.writeUTF(code);
        }
        byte[] payload = bytes.toByteArray(), digest = digest(payload);
        if (payload.length + digest.length > MAX_BYTES) throw new IOException("扫码批次过大");
        String token = UUID.randomUUID().toString().replace("-", "");
        File target = file(directory, token), temporary = new File(directory, token + ".tmp");
        try {
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                stream.write(payload); stream.write(digest); stream.getFD().sync();
            }
            if (!temporary.renameTo(target)) throw new IOException("无法保存扫码批次");
            prune(directory, target);
            return token;
        } finally { temporary.delete(); }
    }

    static ArrayList<String> load(File directory, String token, String mode, String barcode, int expectedCount) throws IOException {
        File source = file(directory, token);
        if (expectedCount < 0 || expectedCount > 10000 || !source.isFile() || source.length() < 32 || source.length() > MAX_BYTES)
            throw new IOException("扫码批次缓存已丢失或无效");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream stream = new FileInputStream(source)) {
            byte[] buffer = new byte[8192]; int length;
            while ((length = stream.read(buffer)) != -1) {
                if (bytes.size() + length > MAX_BYTES) throw new IOException("扫码批次缓存过大");
                bytes.write(buffer, 0, length);
            }
        }
        byte[] all = bytes.toByteArray();
        if (all.length < 32) throw new IOException("扫码批次缓存不完整");
        byte[] payload = Arrays.copyOf(all, all.length - 32), checksum = Arrays.copyOfRange(all, all.length - 32, all.length);
        if (!MessageDigest.isEqual(digest(payload), checksum)) throw new IOException("扫码批次缓存已损坏");
        try (DataInputStream data = new DataInputStream(new ByteArrayInputStream(payload))) {
            if (data.readInt() != MAGIC || !data.readUTF().equals(mode) || !data.readUTF().equals(barcode))
                throw new IOException("扫码批次缓存不匹配");
            int count = data.readInt();
            if (count != expectedCount) throw new IOException("扫码批次计数不匹配");
            ArrayList<String> codes = new ArrayList<>(count);
            for (int index = 0; index < count; index++) codes.add(data.readUTF());
            if (data.read() != -1) throw new IOException("扫码批次缓存无效");
            validate(mode, barcode, codes); return codes;
        }
    }

    static void discard(File directory, String token) {
        try { if (token != null) file(directory, token).delete(); } catch (IOException ignored) {}
    }
    private static File file(File directory, String token) throws IOException {
        if (token == null || !token.matches(TOKEN)) throw new IOException("扫码批次标识无效");
        return new File(directory, token + ".batch");
    }
    private static byte[] digest(byte[] bytes) throws IOException {
        try { return MessageDigest.getInstance("SHA-256").digest(bytes); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IOException("无法校验扫码批次", error); }
    }
    private static void validate(String mode, String barcode, List<String> codes) throws IOException {
        if (!("single".equals(mode) || "multiple".equals(mode) || "unique".equals(mode)) || barcode == null ||
            !(InventoryBatchSession.validCode(barcode, 80) || ("unique".equals(mode) && barcode.isEmpty())) || codes == null || codes.size() > 10000)
            throw new IOException("扫码批次无效");
        Set<String> unique = new HashSet<>();
        for (String code : codes) {
            if (!InventoryBatchSession.validCode(code, "unique".equals(mode) ? 120 : 80) ||
                ("unique".equals(mode) ? !unique.add(code) : !barcode.equals(code))) throw new IOException("扫码批次记录无效");
        }
    }
    private static void prune(File directory, File newest) {
        File[] snapshots = directory.listFiles((dir, name) -> name.matches(TOKEN + "\\.batch"));
        if (snapshots == null || snapshots.length <= MAX_SNAPSHOTS) return;
        Arrays.sort(snapshots, Comparator.comparingLong(File::lastModified));
        int remaining = snapshots.length;
        for (File snapshot : snapshots) {
            if (remaining <= MAX_SNAPSHOTS) break;
            if (!snapshot.equals(newest) && snapshot.delete()) remaining--;
        }
    }
}
