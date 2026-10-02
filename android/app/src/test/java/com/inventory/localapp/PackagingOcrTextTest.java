package com.inventory.localapp;
import org.junit.Test;
import static org.junit.Assert.*;
public class PackagingOcrTextTest {
 @Test public void validatesBoundedNonemptyText(){assertTrue(PackagingOcrText.valid("药名\n规格"));assertFalse(PackagingOcrText.valid(null));assertFalse(PackagingOcrText.valid(" \n "));assertTrue(PackagingOcrText.valid("字".repeat(4000)));assertFalse(PackagingOcrText.valid("字".repeat(4001)));}
 @Test public void limitPreservesRawSingleCaptureAndSurrogates(){String original="  药名\n规格  ";assertEquals(original,PackagingOcrText.limit(original));assertEquals("",PackagingOcrText.limit(null));assertEquals(4000,PackagingOcrText.limit("字".repeat(4001)).length());assertEquals(3999,PackagingOcrText.limit("字".repeat(3999)+"😀").length());}
}
