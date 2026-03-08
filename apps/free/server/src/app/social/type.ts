import { RelationshipStatus } from '@prisma/client';
import { getPublicUrl } from '@/storage/files';

export type UserProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  avatar: {
    path: string;
    url: string;
    width?: number;
    height?: number;
    thumbhash?: string;
  } | null;
  username: string;
  bio: string | null;
  status: RelationshipStatus;
};

export function buildUserProfile(
  account: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    avatar: unknown;
    githubUser: { profile: unknown } | null;
  },
  status: RelationshipStatus
): UserProfile {
  const githubProfile = account.githubUser?.profile as Record<string, unknown> | undefined;
  const avatarJson = account.avatar as Record<string, unknown> | null | undefined;

  let avatar: UserProfile['avatar'] = null;
  if (avatarJson) {
    const avatarData = avatarJson;
    avatar = {
      path: avatarData.path as string,
      url: getPublicUrl(avatarData.path as string),
      width: avatarData.width as number | undefined,
      height: avatarData.height as number | undefined,
      thumbhash: avatarData.thumbhash as string | undefined,
    };
  }

  return {
    id: account.id,
    firstName: account.firstName || '',
    lastName: account.lastName,
    avatar,
    username: account.username || (githubProfile?.login as string) || '',
    bio: (githubProfile?.bio as string) || null,
    status,
  };
}
