package com.inventory.localapp;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class InventoryBatchSnapshotTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private File directory() throws IOException { return temporary.newFolder(); }
    @Test public void maximumUniqueBatchRestoresAllCodesAndCountWithSmallToken() throws Exception {
        File directory=directory();ArrayList<String> codes=new ArrayList<>();
        for(int i=0;i<10000;i++)codes.add(String.format(java.util.Locale.ROOT,"%05d",i)+"A".repeat(115));
        String token=InventoryBatchSnapshot.save(directory,"unique","001",codes);
        assertEquals(32,token.length());assertTrue(new File(directory,token+".batch").length()<=InventoryBatchSnapshot.MAX_BYTES);
        ArrayList<String> restored=InventoryBatchSnapshot.load(directory,token,"unique","001",10000);
        assertEquals(codes,restored);InventoryBatchSession session=new InventoryBatchSession("unique","001");session.restore(restored);assertEquals(10000,session.codes().size());
    }
    @Test public void repeatedOrdinaryBarcodesKeepConfirmedCountAndLeadingZeros() throws Exception {
        File directory=directory();List<String> codes=Collections.nCopies(10000,"00123456789");
        String token=InventoryBatchSnapshot.save(directory,"single","00123456789",codes);
        InventoryBatchSession session=new InventoryBatchSession("single","00123456789");
        session.restore(InventoryBatchSnapshot.load(directory,token,"single","00123456789",10000));
        assertEquals(codes,session.codes());
    }
    @Test public void missingTruncatedAndCorruptedSnapshotsAreRejected() throws Exception {
        File directory=directory();String token=InventoryBatchSnapshot.save(directory,"single","001",Arrays.asList("001"));
        File source=new File(directory,token+".batch");byte[] bytes=Files.readAllBytes(source.toPath());
        bytes[10]^=1;Files.write(source.toPath(),bytes);
        assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"single","001",1));
        Files.write(source.toPath(),Arrays.copyOf(bytes,10));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"single","001",1));
        assertTrue(source.delete());assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"single","001",1));
    }
    @Test public void differentProductModeCountAndInvalidTokensCannotRestore() throws Exception {
        File directory=directory();String token=InventoryBatchSnapshot.save(directory,"single","001",Arrays.asList("001"));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"single","002",1));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"multiple","001",1));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,token,"single","001",2));
        for(String invalid:Arrays.asList("../escape",token+".batch","",null))
            assertThrows(IOException.class,()->InventoryBatchSnapshot.load(directory,invalid,"single","001",1));
    }
    @Test public void invalidOrOversizeBatchCannotCreateSnapshot() throws Exception {
        File directory=directory();
        assertThrows(IOException.class,()->InventoryBatchSnapshot.save(directory,"unique","",Arrays.asList("duplicate","duplicate")));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.save(directory,"single","001",Arrays.asList("002")));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.save(directory,"unique","",Arrays.asList("A".repeat(121))));
        assertThrows(IOException.class,()->InventoryBatchSnapshot.save(directory,"single","001",Collections.nCopies(10001,"001")));
        assertEquals(0,directory.listFiles().length);
    }
    @Test public void cacheIsBoundedAndOnlyKnownSnapshotsAreDeleted() throws Exception {
        File directory=directory();File unrelated=new File(directory,"keep-me.txt");Files.write(unrelated.toPath(),new byte[]{1});String last=null;
        for(int i=0;i<12;i++)last=InventoryBatchSnapshot.save(directory,"single","001",Arrays.asList("001"));
        assertTrue(unrelated.isFile());assertEquals(InventoryBatchSnapshot.MAX_SNAPSHOTS+1,directory.listFiles().length);
        assertEquals(Arrays.asList("001"),InventoryBatchSnapshot.load(directory,last,"single","001",1));
        InventoryBatchSnapshot.discard(directory,last);assertFalse(new File(directory,last+".batch").exists());
    }
    @Test public void emptyConfirmedSessionAlsoRestores() throws Exception {
        File directory=directory();String token=InventoryBatchSnapshot.save(directory,"multiple","001",Collections.emptyList());
        assertTrue(InventoryBatchSnapshot.load(directory,token,"multiple","001",0).isEmpty());
    }
}
