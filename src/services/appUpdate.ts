import { Platform } from 'react-native';
import SpInAppUpdates, {
  IAUUpdateKind,
  StartUpdateOptions,
  StatusUpdateEvent,
} from 'sp-react-native-in-app-updates';

const InstallStatus = {
  DOWNLOADED: 11,
} as const;

let inAppUpdates: SpInAppUpdates | null = null;
let statusListener: ((event: StatusUpdateEvent) => void) | null = null;

function getClient(): SpInAppUpdates {
  if (!inAppUpdates) {
    inAppUpdates = new SpInAppUpdates(false);
  }
  return inAppUpdates;
}

export async function checkAndStartFlexibleUpdate(
  onDownloaded: () => void,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const client = getClient();
    const result = await client.checkNeedsUpdate();
    if (!result.shouldUpdate) return;

    if (statusListener) {
      client.removeStatusUpdateListener(statusListener);
      statusListener = null;
    }

    statusListener = (event: StatusUpdateEvent) => {
      if (event.status === InstallStatus.DOWNLOADED) {
        onDownloaded();
      }
    };
    client.addStatusUpdateListener(statusListener);

    const options: StartUpdateOptions = {
      updateType: IAUUpdateKind.FLEXIBLE,
    };
    await client.startUpdate(options);
  } catch (err) {
    console.warn('[appUpdate] check/start failed:', err);
  }
}

export async function installUpdate(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    getClient().installUpdate();
  } catch (err) {
    console.warn('[appUpdate] install failed:', err);
  }
}
