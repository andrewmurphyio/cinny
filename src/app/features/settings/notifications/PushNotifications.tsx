import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, Switch, Button, color, Spinner } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import {
  isPushSupported,
  isPushConfigured,
  isSubscribedToPush,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../../utils/pushNotifications';

export function PushNotifications() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const pushConfig = clientConfig.push;
  const notifPermission = usePermissionState('notifications', getNotificationState());

  const [subscribed, setSubscribed] = useState<boolean | undefined>(undefined);

  // Check initial subscription status
  useEffect(() => {
    if (isPushSupported() && isPushConfigured(pushConfig)) {
      isSubscribedToPush().then(setSubscribed);
    }
  }, [pushConfig]);

  const [subscribeState, handleSubscribe] = useAsyncCallback(
    useCallback(async () => {
      if (!pushConfig) throw new Error('Push not configured');
      await subscribeToPush(mx, pushConfig);
      setSubscribed(true);
    }, [mx, pushConfig])
  );

  const [unsubscribeState, handleUnsubscribe] = useAsyncCallback(
    useCallback(async () => {
      await unsubscribeFromPush(mx, pushConfig);
      setSubscribed(false);
    }, [mx, pushConfig])
  );

  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      handleSubscribe();
    } else {
      handleUnsubscribe();
    }
  };

  // Don't show if push is not supported or not configured
  if (!isPushSupported() || !isPushConfigured(pushConfig)) {
    return null;
  }

  const isLoading =
    subscribed === undefined ||
    subscribeState.status === AsyncStatus.Loading ||
    unsubscribeState.status === AsyncStatus.Loading;

  const hasError =
    subscribeState.status === AsyncStatus.Error ||
    unsubscribeState.status === AsyncStatus.Error;

  const errorMessage =
    subscribeState.status === AsyncStatus.Error
      ? (subscribeState.error as Error)?.message
      : unsubscribeState.status === AsyncStatus.Error
        ? (unsubscribeState.error as Error)?.message
        : undefined;

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Push Notifications"
        description={
          <>
            {notifPermission === 'denied' && (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                Notification permission was denied. Please enable in browser settings.
              </Text>
            )}
            {notifPermission !== 'denied' && !hasError && (
              <span>
                Receive push notifications when the app is closed.{' '}
                <Text as="span" size="T200" priority="300">
                  Works best when added to home screen (PWA).
                </Text>
              </span>
            )}
            {hasError && (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {errorMessage || 'Failed to update push notifications'}
              </Text>
            )}
          </>
        }
        after={
          <>
            {isLoading && <Spinner variant="Secondary" />}
            {!isLoading && notifPermission === 'prompt' && !subscribed && (
              <Button size="300" radii="300" onClick={() => handleToggle(true)}>
                <Text size="B300">Enable</Text>
              </Button>
            )}
            {!isLoading && notifPermission !== 'prompt' && (
              <Switch
                disabled={notifPermission === 'denied'}
                value={subscribed ?? false}
                onChange={handleToggle}
              />
            )}
          </>
        }
      />
    </SequenceCard>
  );
}
