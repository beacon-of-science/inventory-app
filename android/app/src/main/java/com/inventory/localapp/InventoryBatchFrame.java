package com.inventory.localapp;
import java.util.ArrayList;
/** Spatial suppression applies only within one frame, never by barcode value. */
public final class InventoryBatchFrame {
    private final ArrayList<int[]> boxes = new ArrayList<>();
    public boolean add(int left,int top,int right,int bottom) {
        if(right<=left || bottom<=top)return false;
        double area=(double)(right-left)*(bottom-top);
        for(int[] b:boxes) {
            double intersection=(double)Math.max(0,Math.min(right,b[2])-Math.max(left,b[0]))*Math.max(0,Math.min(bottom,b[3])-Math.max(top,b[1]));
            double smaller=Math.min(area,(double)(b[2]-b[0])*(b[3]-b[1]));
            if(intersection/smaller>0.5)return false;
        }
        boxes.add(new int[]{left,top,right,bottom}); return true;
    }
}
