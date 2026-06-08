import { describe, expect, it } from "vitest";
import { formatIdentityProfile } from "./identity-profile.js";

const completedProfile = {
  twinId: "twin-id",
  displayName: "John",
  aliases: ["John Doe"],
  emails: [],
  phones: [],
  handles: {},
  selfDescriptionArtifactId: "artifact-id",
};

describe("identity profile first-meet intro response", () => {
  it("defaults legacy completed users to consumed without replaying the intro", () => {
    expect(
      formatIdentityProfile("twin-id", completedProfile, {
        onboardingStatus: "completed",
        firstMeetIntroStatus: undefined,
        shouldPlayFirstMeetIntro: false,
      }),
    ).toMatchObject({
      onboardingStatus: "completed",
      firstMeetIntroStatus: "consumed",
      shouldPlayFirstMeetIntro: false,
      events: [],
    });
  });

  it("emits a pending runtime event when the first-meet intro is issued", () => {
    expect(
      formatIdentityProfile(
        "twin-id",
        completedProfile,
        {
          onboardingStatus: "completed",
          firstMeetIntroStatus: "issued",
          shouldPlayFirstMeetIntro: true,
        },
        { twinName: "Nova" },
      ),
    ).toMatchObject({
      firstMeetIntroStatus: "issued",
      events: [
        {
          type: "first_meet_intro.requested",
          eventId: "twin-id:first-meet-intro",
          dedupeKey: "twin-id:first-meet-intro",
          text: "Hi John! I'm Nova. It's really good to finally meet you. I've got your first memory now, and I'm ready to start learning your world with you.",
          voiceStyle: "energetic",
        },
      ],
    });
  });

  it("keeps issued first-meet events pending across reload responses", () => {
    expect(
      formatIdentityProfile("twin-id", completedProfile, {
        onboardingStatus: "completed",
        firstMeetIntroStatus: "issued",
        shouldPlayFirstMeetIntro: false,
      }),
    ).toMatchObject({
      firstMeetIntroStatus: "issued",
      shouldPlayFirstMeetIntro: false,
      events: [
        {
          type: "first_meet_intro.requested",
          eventId: "twin-id:first-meet-intro",
        },
      ],
    });
  });
});
