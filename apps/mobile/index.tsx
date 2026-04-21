import { registerRootComponent } from "expo";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { registerGlobals } from "react-native-webrtc";

import "./global.css";
import App from "./App";

registerGlobals();

// Wrap App in SafeAreaProvider here so useSafeAreaInsets() inside App
// has the context it needs. If SafeAreaProvider were inside App's JSX
// return, the hook would run before the provider is mounted.
function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

registerRootComponent(Root);
