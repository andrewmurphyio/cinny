import React from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { NavCategory, NavItem, NavItemContent, NavLink } from '../../../components/nav';
import { getInboxInvitesPath, getInboxNotificationsPath, getInboxUnreadPath } from '../../pathUtils';
import {
  useInboxInvitesSelected,
  useInboxNotificationsSelected,
  useInboxUnreadSelected,
} from '../../../hooks/router/useInbox';
import { UnreadBadge } from '../../../components/unread-badge';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getNotificationType } from '../../../utils/room';
import { NotificationType } from '../../../../types/matrix/room';

function InvitesNavItem() {
  const invitesSelected = useInboxInvitesSelected();
  const allInvites = useAtomValue(allInvitesAtom);
  const inviteCount = allInvites.length;

  return (
    <NavItem
      variant="Background"
      radii="400"
      highlight={inviteCount > 0}
      aria-selected={invitesSelected}
    >
      <NavLink to={getInboxInvitesPath()}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <Icon src={Icons.Mail} size="100" filled={invitesSelected} />
            </Avatar>
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" truncate>
                Invites
              </Text>
            </Box>
            {inviteCount > 0 && <UnreadBadge highlight count={inviteCount} />}
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

function UnreadNavItem() {
  const mx = useMatrixClient();
  const unreadSelected = useInboxUnreadSelected();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const allRooms = useAtomValue(allRoomsAtom);

  // Count rooms with unreads (using same filtering as Unread page)
  const unreadRoomCount = React.useMemo(() => {
    const allRoomIds = new Set(allRooms);
    let count = 0;

    roomToUnread.forEach((unread, roomId) => {
      if (!allRoomIds.has(roomId)) return;
      const room = mx.getRoom(roomId);
      if (!room || room.isSpaceRoom()) return;

      const notificationType = getNotificationType(mx, roomId);
      if (notificationType === NotificationType.Mute) return;
      if (notificationType === NotificationType.MentionsAndKeywords && unread.highlight === 0) return;

      if (unread.total > 0 || unread.highlight > 0) {
        count++;
      }
    });

    return count;
  }, [mx, roomToUnread, allRooms]);

  return (
    <NavItem
      variant="Background"
      radii="400"
      highlight={unreadRoomCount > 0}
      aria-selected={unreadSelected}
    >
      <NavLink to={getInboxUnreadPath()}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <Icon src={Icons.MessageUnread} size="100" filled={unreadSelected} />
            </Avatar>
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" truncate>
                Unread
              </Text>
            </Box>
            {unreadRoomCount > 0 && <UnreadBadge highlight={false} count={unreadRoomCount} />}
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

export function Inbox() {
  useNavToActivePathMapper('inbox');
  const notificationsSelected = useInboxNotificationsSelected();

  return (
    <PageNav>
      <PageNavHeader>
        <Box grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              Inbox
            </Text>
          </Box>
        </Box>
      </PageNavHeader>

      <PageNavContent>
        <Box direction="Column" gap="300">
          <NavCategory>
            <NavItem variant="Background" radii="400" aria-selected={notificationsSelected}>
              <NavLink to={getInboxNotificationsPath()}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Bell} size="100" filled={notificationsSelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Notifications
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
            <UnreadNavItem />
            <InvitesNavItem />
          </NavCategory>
        </Box>
      </PageNavContent>
    </PageNav>
  );
}
