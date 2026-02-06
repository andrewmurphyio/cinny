import { useCallback, useEffect, useMemo } from 'react';
import { RoomStateEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useAccountData } from './useAccountData';
import {
  setRoomNotificationPreference,
  RoomNotificationMode,
  useRoomsNotificationPreferencesContext,
  getRoomNotificationMode,
} from './useRoomsNotificationPreferences';

// Account data event type
export const SPACE_MUTE_EVENT = 'm.cinny.space_mute';

export interface SpaceMuteEntry {
  muteUntil: number | null; // Unix timestamp (ms) or null for indefinite
  mutedAt: number; // When mute was set
  mutedRooms: string[]; // Room IDs we muted
}

export interface SpaceMuteData {
  version: 1;
  spaces: Record<string, SpaceMuteEntry>;
}

const DEFAULT_SPACE_MUTE_DATA: SpaceMuteData = {
  version: 1,
  spaces: {},
};

/**
 * Parse account data, handling missing/malformed data
 */
const parseSpaceMuteData = (event: MatrixEvent | undefined): SpaceMuteData => {
  if (!event) return DEFAULT_SPACE_MUTE_DATA;

  const content = event.getContent() as SpaceMuteData | undefined;
  if (!content || typeof content !== 'object' || !content.spaces) {
    return DEFAULT_SPACE_MUTE_DATA;
  }

  return {
    version: 1,
    spaces: content.spaces || {},
  };
};

/**
 * Check if a space mute has expired
 */
export const isSpaceMuteExpired = (entry: SpaceMuteEntry): boolean => {
  if (entry.muteUntil === null) return false; // Indefinite
  return Date.now() > entry.muteUntil;
};

/**
 * Get human-readable time remaining for mute
 */
export const getMuteTimeRemaining = (entry: SpaceMuteEntry): string | null => {
  if (entry.muteUntil === null) return null;

  const remaining = entry.muteUntil - Date.now();
  if (remaining <= 0) return 'expired';

  const minutes = Math.floor(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
};

/**
 * Get all child room IDs for a space (recursive)
 */
const getSpaceChildRoomIds = (mx: MatrixClient, spaceId: string): string[] => {
  const space = mx.getRoom(spaceId);
  if (!space) return [];

  const childRoomIds: string[] = [];
  const childEvents = space.currentState.getStateEvents('m.space.child');

  for (const event of childEvents) {
    const childId = event.getStateKey();
    if (!childId) continue;

    const content = event.getContent();
    // Skip if the child has been removed (empty content or no via)
    if (!content.via || content.via.length === 0) continue;

    const childRoom = mx.getRoom(childId);
    if (!childRoom) continue;

    // Check if this is a space (has m.space.child state events with content)
    const grandchildEvents = childRoom.currentState.getStateEvents('m.space.child');
    const isSpace = grandchildEvents.some((e: MatrixEvent) => {
      const c = e.getContent() as { via?: string[] };
      return c.via && c.via.length > 0;
    });

    if (isSpace) {
      // It's a nested space - recurse
      childRoomIds.push(...getSpaceChildRoomIds(mx, childId));
    } else {
      // It's a room
      childRoomIds.push(childId);
    }
  }

  return childRoomIds;
};

/**
 * Main hook for space mute functionality
 */
export const useSpaceMute = () => {
  const mx = useMatrixClient();
  const accountDataEvent = useAccountData(SPACE_MUTE_EVENT);
  const roomNotifPrefs = useRoomsNotificationPreferencesContext();

  const spaceMuteData = useMemo(
    () => parseSpaceMuteData(accountDataEvent),
    [accountDataEvent]
  );

  /**
   * Check if a space is currently muted
   */
  const isSpaceMuted = useCallback(
    (spaceId: string): boolean => {
      const entry = spaceMuteData.spaces[spaceId];
      if (!entry) return false;
      return !isSpaceMuteExpired(entry);
    },
    [spaceMuteData]
  );

  /**
   * Get mute entry for a space
   */
  const getSpaceMuteEntry = useCallback(
    (spaceId: string): SpaceMuteEntry | undefined => {
      return spaceMuteData.spaces[spaceId];
    },
    [spaceMuteData]
  );

  /**
   * Save space mute data to account data
   */
  const saveSpaceMuteData = useCallback(
    async (data: SpaceMuteData): Promise<void> => {
      await mx.setAccountData(SPACE_MUTE_EVENT, data);
    },
    [mx]
  );

  /**
   * Mute a space for a duration
   * @param spaceId - The space to mute
   * @param muteUntil - Unix timestamp (ms) when to unmute, or null for indefinite
   */
  const muteSpace = useCallback(
    async (spaceId: string, muteUntil: number | null): Promise<void> => {
      // Get all child rooms
      const childRoomIds = getSpaceChildRoomIds(mx, spaceId);

      // Mute each room
      for (const roomId of childRoomIds) {
        try {
          const currentMode = getRoomNotificationMode(roomNotifPrefs, roomId);
          if (currentMode !== RoomNotificationMode.Mute) {
            await setRoomNotificationPreference(
              mx,
              roomId,
              RoomNotificationMode.Mute,
              currentMode
            );
          }
        } catch (error) {
          console.error(`Failed to mute room ${roomId}:`, error);
        }
      }

      // Save to account data
      const newData: SpaceMuteData = {
        ...spaceMuteData,
        spaces: {
          ...spaceMuteData.spaces,
          [spaceId]: {
            muteUntil,
            mutedAt: Date.now(),
            mutedRooms: childRoomIds,
          },
        },
      };

      await saveSpaceMuteData(newData);
    },
    [mx, spaceMuteData, saveSpaceMuteData, roomNotifPrefs]
  );

  /**
   * Unmute a space and all its tracked rooms
   */
  const unmuteSpace = useCallback(
    async (spaceId: string): Promise<void> => {
      const entry = spaceMuteData.spaces[spaceId];
      if (!entry) return;

      // Unmute each tracked room
      for (const roomId of entry.mutedRooms) {
        try {
          const currentMode = getRoomNotificationMode(roomNotifPrefs, roomId);
          if (currentMode === RoomNotificationMode.Mute) {
            await setRoomNotificationPreference(
              mx,
              roomId,
              RoomNotificationMode.Unset,
              RoomNotificationMode.Mute
            );
          }
        } catch (error) {
          console.error(`Failed to unmute room ${roomId}:`, error);
        }
      }

      // Remove from account data
      const { [spaceId]: removed, ...remainingSpaces } = spaceMuteData.spaces;
      const newData: SpaceMuteData = {
        ...spaceMuteData,
        spaces: remainingSpaces,
      };

      await saveSpaceMuteData(newData);
    },
    [mx, spaceMuteData, saveSpaceMuteData, roomNotifPrefs]
  );

  /**
   * Check all spaces for expired mutes and unmute them
   */
  const checkAndUnmuteExpired = useCallback(async (): Promise<void> => {
    const expiredSpaces = Object.entries(spaceMuteData.spaces)
      .filter(([, entry]) => isSpaceMuteExpired(entry))
      .map(([spaceId]) => spaceId);

    for (const spaceId of expiredSpaces) {
      await unmuteSpace(spaceId);
    }
  }, [spaceMuteData, unmuteSpace]);

  // Check for expired mutes on mount and periodically
  useEffect(() => {
    checkAndUnmuteExpired();

    // Check every minute
    const interval = setInterval(checkAndUnmuteExpired, 60000);

    return () => clearInterval(interval);
  }, [checkAndUnmuteExpired]);

  return {
    spaceMuteData,
    isSpaceMuted,
    getSpaceMuteEntry,
    muteSpace,
    unmuteSpace,
    checkAndUnmuteExpired,
  };
};

/**
 * Hook to auto-mute new rooms added to muted spaces
 */
export const useAutoMuteNewRooms = () => {
  const mx = useMatrixClient();
  const { spaceMuteData, isSpaceMuted, getSpaceMuteEntry } = useSpaceMute();
  const roomNotifPrefs = useRoomsNotificationPreferencesContext();

  useEffect(() => {
    const handleStateEvent = async (event: MatrixEvent) => {
      if (event.getType() !== 'm.space.child') return;

      const spaceId = event.getRoomId();
      const childRoomId = event.getStateKey();

      if (!spaceId || !childRoomId) return;
      if (!isSpaceMuted(spaceId)) return;

      // Check if content indicates the room is being added (not removed)
      const content = event.getContent();
      if (!content.via || content.via.length === 0) return; // Room being removed

      // Mute the new room
      try {
        const currentMode = getRoomNotificationMode(roomNotifPrefs, childRoomId);
        if (currentMode !== RoomNotificationMode.Mute) {
          await setRoomNotificationPreference(
            mx,
            childRoomId,
            RoomNotificationMode.Mute,
            currentMode
          );
        }

        // Update account data to track this room
        const entry = getSpaceMuteEntry(spaceId);
        if (entry && !entry.mutedRooms.includes(childRoomId)) {
          const newEntry: SpaceMuteEntry = {
            ...entry,
            mutedRooms: [...entry.mutedRooms, childRoomId],
          };

          await mx.setAccountData(SPACE_MUTE_EVENT, {
            ...spaceMuteData,
            spaces: {
              ...spaceMuteData.spaces,
              [spaceId]: newEntry,
            },
          });
        }
      } catch (error) {
        console.error(`Failed to auto-mute new room ${childRoomId} in space ${spaceId}:`, error);
      }
    };

    mx.on(RoomStateEvent.Events, handleStateEvent);

    return () => {
      mx.off(RoomStateEvent.Events, handleStateEvent);
    };
  }, [mx, spaceMuteData, isSpaceMuted, getSpaceMuteEntry, roomNotifPrefs]);
};

/**
 * Predefined mute durations
 */
export const MUTE_DURATIONS = {
  ONE_HOUR: 60 * 60 * 1000,
  EIGHT_HOURS: 8 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;
