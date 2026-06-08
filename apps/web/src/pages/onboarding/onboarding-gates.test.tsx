import { describe, it } from "vitest";
import {
  run_shows_wallet_auth_gate_without_showing_onboarding_for_unveri,
  run_shows_onboarding_only_after_wallet_verification_resolves_to_,
  run_shows_neither_wallet_auth_nor_onboarding_for_completed_users
} from "./onboarding-gates.test-scenarios";

describe("onboarding gates / shows wallet auth gate without showing onboar", () => {
  it("shows wallet auth gate without showing onboarding for unverified wallets", () => run_shows_wallet_auth_gate_without_showing_onboarding_for_unveri());
});

describe("onboarding gates / shows onboarding only after wallet verificati", () => {
  it("shows onboarding only after wallet verification resolves to unfinished onboarding", () => run_shows_onboarding_only_after_wallet_verification_resolves_to_());
});

describe("onboarding gates / shows neither wallet auth nor onboarding for ", () => {
  it("shows neither wallet auth nor onboarding for completed users", () => run_shows_neither_wallet_auth_nor_onboarding_for_completed_users());
});
