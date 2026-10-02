package com.inventory.localapp;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InventoryScannerPlugin.class);
        registerPlugin(InventoryNavigationPlugin.class);
        registerPlugin(InventoryOcrPlugin.class);
        registerPlugin(InventoryFilesPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                // IME dismissal takes priority over application navigation.
                android.view.View root=getWindow().getDecorView();
                WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(root);
                if(insets!=null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    new WindowInsetsControllerCompat(getWindow(),root).hide(WindowInsetsCompat.Type.ime());
                    return;
                }
                if(getBridge()!=null) getBridge().triggerWindowJSEvent("inventory-back");
                else moveTaskToBack(true);
            }
        });
    }
}
