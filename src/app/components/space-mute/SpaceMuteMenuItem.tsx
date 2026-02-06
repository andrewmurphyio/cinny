import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Icon,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
  Spinner,
  Line,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import {
  useSpaceMute,
  MUTE_DURATIONS,
  getMuteTimeRemaining,
} from '../../hooks/useSpaceMute';
import { stopPropagation } from '../../utils/keyboard';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';

interface MuteOption {
  label: string;
  duration: number | null; // null = indefinite
}

const MUTE_OPTIONS: MuteOption[] = [
  { label: 'For 1 hour', duration: MUTE_DURATIONS.ONE_HOUR },
  { label: 'For 8 hours', duration: MUTE_DURATIONS.EIGHT_HOURS },
  { label: 'For 24 hours', duration: MUTE_DURATIONS.ONE_DAY },
  { label: 'For 1 week', duration: MUTE_DURATIONS.ONE_WEEK },
  { label: 'Until I turn it back on', duration: null },
];

interface SpaceMuteMenuProps {
  spaceId: string;
  requestClose: () => void;
}

export function SpaceMuteMenuItem({ spaceId, requestClose }: SpaceMuteMenuProps) {
  const { muteSpace, isSpaceMuted, unmuteSpace, getSpaceMuteEntry } = useSpaceMute();
  const isMuted = isSpaceMuted(spaceId);
  const muteEntry = getSpaceMuteEntry(spaceId);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const [muteState, handleMute] = useAsyncCallback(
    useCallback(
      async (duration: number | null) => {
        const muteUntil = duration !== null ? Date.now() + duration : null;
        await muteSpace(spaceId, muteUntil);
      },
      [muteSpace, spaceId]
    )
  );

  const [unmuteState, handleUnmute] = useAsyncCallback(
    useCallback(async () => {
      await unmuteSpace(spaceId);
    }, [unmuteSpace, spaceId])
  );

  const isLoading =
    muteState.status === AsyncStatus.Loading || unmuteState.status === AsyncStatus.Loading;

  // Close menus on success
  useEffect(() => {
    if (muteState.status === AsyncStatus.Success || unmuteState.status === AsyncStatus.Success) {
      setMenuAnchor(undefined);
      requestClose();
    }
  }, [muteState.status, unmuteState.status, requestClose]);

  const handleOpenSubmenu = (evt: React.MouseEvent<HTMLButtonElement>) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleCloseSubmenu = () => {
    setMenuAnchor(undefined);
  };

  return (
    <>
      <MenuItem
        size="300"
        radii="300"
        onClick={handleOpenSubmenu}
        after={<Icon size="100" src={Icons.ChevronRight} />}
        before={<Icon size="100" src={isMuted ? Icons.Bell : Icons.BellMute} />}
        aria-pressed={!!menuAnchor}
      >
        <Text as="span" size="T300" truncate style={{ flexGrow: 1 }}>
          {isMuted ? 'Muted' : 'Mute Space'}
        </Text>
      </MenuItem>

      {menuAnchor && (
        <PopOut
          anchor={menuAnchor}
          position="Right"
          align="Start"
          offset={4}
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: handleCloseSubmenu,
                clickOutsideDeactivates: true,
                isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                escapeDeactivates: stopPropagation,
              }}
            >
              <Menu style={{ minWidth: '180px' }}>
                <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                  {isMuted ? (
                    <>
                      {/* Show current mute status */}
                      <Box
                        direction="Column"
                        gap="100"
                        style={{ padding: config.space.S100 }}
                      >
                        <Text size="T200" priority="300">
                          {muteEntry && muteEntry.muteUntil
                            ? `${getMuteTimeRemaining(muteEntry)} remaining`
                            : 'Muted indefinitely'}
                        </Text>
                        <Text size="T200" priority="300">
                          {muteEntry?.mutedRooms.length || 0} rooms muted
                        </Text>
                      </Box>

                      <Line size="300" variant="Surface" direction="Horizontal" />

                      {/* Unmute option */}
                      <MenuItem
                        size="300"
                        radii="300"
                        disabled={isLoading}
                        onClick={() => handleUnmute()}
                        before={
                          isLoading ? (
                            <Spinner size="100" />
                          ) : (
                            <Icon size="100" src={Icons.Bell} />
                          )
                        }
                      >
                        <Text as="span" size="T300">
                          Unmute Space
                        </Text>
                      </MenuItem>

                      <Line size="300" variant="Surface" direction="Horizontal" />

                      {/* Change duration */}
                      <Text
                        size="T200"
                        priority="300"
                        style={{ padding: config.space.S100 }}
                      >
                        Change duration:
                      </Text>
                      {MUTE_OPTIONS.map((option) => (
                        <MenuItem
                          key={option.label}
                          size="300"
                          radii="300"
                          disabled={isLoading}
                          onClick={() => handleMute(option.duration)}
                        >
                          <Text as="span" size="T300">
                            {option.label}
                          </Text>
                        </MenuItem>
                      ))}
                    </>
                  ) : (
                    <>
                      {/* Mute options */}
                      {MUTE_OPTIONS.map((option) => (
                        <MenuItem
                          key={option.label}
                          size="300"
                          radii="300"
                          disabled={isLoading}
                          onClick={() => handleMute(option.duration)}
                          before={
                            isLoading ? (
                              <Spinner size="100" />
                            ) : (
                              <Icon
                                size="100"
                                src={option.duration === null ? Icons.BellMute : Icons.Clock}
                              />
                            )
                          }
                        >
                          <Text as="span" size="T300">
                            {option.label}
                          </Text>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Box>
              </Menu>
            </FocusTrap>
          }
        />
      )}
    </>
  );
}
