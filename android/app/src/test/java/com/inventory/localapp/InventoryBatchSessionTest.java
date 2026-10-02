package com.inventory.localapp;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;
public class InventoryBatchSessionTest {
 @Test public void ordinaryNeverAutoIncrements() {
  InventoryBatchSession s=new InventoryBatchSession("single","001"); for(int i=0;i<100;i++) s.observeUnique("001"); assertEquals(0,s.codes().size()); s.confirmSingle();s.confirmSingle();assertEquals(Arrays.asList("001","001"),s.codes());
 }
 @Test public void sameValueSeparateBoxesAndFrameReset() {
  InventoryBatchFrame f=new InventoryBatchFrame();assertTrue(f.add(0,0,100,50));assertFalse(f.add(1,1,101,51));assertTrue(f.add(120,0,220,50));assertFalse(f.add(0,0,0,0));assertTrue(new InventoryBatchFrame().add(0,0,100,50));
 }
 @Test public void upcAliasRequiresDecodedFormatAndDigits() {
  InventoryBatchSession s=new InventoryBatchSession("multiple","123456789012"); assertTrue(s.matchesOrdinary("0123456789012","EAN_13","UPC_A"));assertFalse(s.matchesOrdinary("0123456789012","CODE_128",null));assertFalse(s.matchesOrdinary("0123456789012","EAN_13","CODE_128"));assertFalse(s.matchesOrdinary("1123456789012","EAN_13",null));
  s=new InventoryBatchSession("multiple","0123456789012");assertTrue(s.matchesOrdinary("123456789012","UPC_A","EAN_13"));assertFalse(s.matchesOrdinary("123456789012","CODE_128",null));
 }
 @Test public void uniqueRejectsScannedSkuButManualIsExplicit() {
  InventoryBatchSession s=new InventoryBatchSession("unique","123456789012");assertFalse(s.observeScannedUnique("123456789012",null));assertFalse(s.observeScannedUnique("0123456789012","EAN_13"));assertTrue(s.observeUnique("123456789012"));
  String code="A".repeat(120);assertTrue(s.observeScannedUnique(code,"CODE_128"));assertFalse(s.observeScannedUnique(code,"CODE_128"));assertFalse(s.observeUnique(code+"A"));assertFalse(s.observeUnique("中"));
  InventoryBatchSession restored=new InventoryBatchSession("unique","");restored.restore(Arrays.asList(code,code));assertEquals(1,restored.codes().size());assertTrue(restored.observeScannedUnique("123456789012","UPC_A"));
 }
}
