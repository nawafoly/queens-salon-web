import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { app } from "./firebase";
import { PartnerService } from "./partnerService";
import type { CreatePartnerMemberInput } from "../types/partner";

const PROVISIONING_APP_NAME = "partner-account-provisioning";

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getProvisioningAuth() {
  const secondaryApp = getApps().some((candidate) => candidate.name === PROVISIONING_APP_NAME)
    ? getApp(PROVISIONING_APP_NAME)
    : initializeApp(app.options, PROVISIONING_APP_NAME);
  return getAuth(secondaryApp);
}

async function createFirebaseAccount(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const email = cleanEmail(input.email);
  const password = String(input.password || "");
  const displayName = String(input.displayName || "").trim();

  if (!email || !email.includes("@")) {
    throw new Error("partner_account:email_invalid");
  }
  if (password.length < 8) {
    throw new Error("partner_account:password_too_short");
  }

  const provisioningAuth = getProvisioningAuth();
  await setPersistence(provisioningAuth, inMemoryPersistence);
  await signOut(provisioningAuth).catch(() => undefined);
  const credential = await createUserWithEmailAndPassword(
    provisioningAuth,
    email,
    password
  );
  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }
  return { provisioningAuth, user: credential.user, email };
}

async function rollbackUser(user: User) {
  try {
    await deleteUser(user);
  } catch (error) {
    console.warn("[partnerAccount] failed to rollback Firebase user", error);
  }
}

export const PartnerAccountService = {
  async createMemberWithAccount(
    member: CreatePartnerMemberInput,
    password: string
  ) {
    const provisioned = await createFirebaseAccount({
      email: member.email || "",
      password,
      displayName: member.displayName,
    });

    try {
      const memberId = await PartnerService.createPartnerMember({
        ...member,
        email: provisioned.email,
        userUid: provisioned.user.uid,
      });
      return { memberId, userUid: provisioned.user.uid, email: provisioned.email };
    } catch (error) {
      await rollbackUser(provisioned.user);
      throw error;
    } finally {
      await signOut(provisioned.provisioningAuth).catch(() => undefined);
    }
  },

  async linkExistingMemberAccount(input: {
    memberId: string;
    displayName: string;
    email: string;
    password: string;
  }) {
    const provisioned = await createFirebaseAccount(input);

    try {
      return await PartnerService.linkPartnerMemberAccount(input.memberId, {
        userUid: provisioned.user.uid,
        email: provisioned.email,
      });
    } catch (error) {
      await rollbackUser(provisioned.user);
      throw error;
    } finally {
      await signOut(provisioned.provisioningAuth).catch(() => undefined);
    }
  },
};
