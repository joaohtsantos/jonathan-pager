import { registerRootComponent } from 'expo';

// Defines the encrypted porter push task at module scope so a headless launch
// (data-only FCM message while the app is killed) finds it.
import './porter/pushTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
