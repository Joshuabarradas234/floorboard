// Every so often, while the app is closed, the phone wakes it to refresh the widget: WorkManager on Android, BGTaskScheduler
// on iPhone (where the widget also refreshes itself every 15 minutes). The phone decides when, at least 15 minutes apart.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { refreshAndRedraw } from './refresh';

const TASK = 'floorboard-widget-refresh';

TaskManager.defineTask(TASK, async () => {
  try {
    await refreshAndRedraw();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function startBackgroundRefresh() {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
  } catch (e) { /* not available (the iPhone simulator, or background refresh switched off): the widget still refreshes itself */ }
}
export async function stopBackgroundRefresh() {
  try { if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK); } catch (e) { /* wasn't on */ }
}
