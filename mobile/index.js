import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import App from './App';
import { widgetTaskHandler } from './src/android/widgetTaskHandler';
import './src/background'; // the background refresh task has to be defined when the app starts, even in the background

registerRootComponent(App);
registerWidgetTaskHandler(widgetTaskHandler);
