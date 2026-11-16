import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getOrCreateUser, type UserRole } from '../db/users.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface DbUserInfo {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: DbUserInfo;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in or missing authentication token.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;

    const email = decoded.email || `${decoded.uid}@user.local`;
    const displayName = typeof decoded.name === 'string' ? decoded.name : '';
    const dbUser = await getOrCreateUser(decoded.uid, email, displayName);
    req.dbUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      displayName: dbUser.displayName,
      role: (dbUser.role as UserRole) || 'viewer',
    };

    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Invalid or expired sign-in session.' });
  }
};

export const requireEditor = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.dbUser?.role;
  if (role !== 'admin' && role !== 'editor') {
    return res.status(403).json({
      error: 'Your account has Viewer access only. Contact an administrator to request Editor access.',
    });
  }
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.dbUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges are required for this action.' });
  }
  next();
};
