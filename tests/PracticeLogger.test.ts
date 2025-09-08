// PracticeLogger.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface PracticeLog {
  practice_type: string;
  category: string;
  timestamp: number;
  details: string;
  evidence_hash: string | null; // Changed from Buffer to string
  moderation_status: string;
  moderation_notes: string | null;
  moderation_timestamp: number | null;
}

interface ContractState {
  contract_owner: string;
  moderator: string;
  practices: Map<string, PracticeLog>; // Key as `${farmer}-${logId}`
  farmer_log_count: Map<string, number>;
}

// Mock contract implementation
class PracticeLoggerMock {
  private state: ContractState = {
    contract_owner: "deployer",
    moderator: "deployer",
    practices: new Map(),
    farmer_log_count: new Map(),
  };

  private ERR_NOT_AUTHORIZED = 200;
  private ERR_NOT_VERIFIED = 202;
  private ERR_INVALID_INPUT = 203;
  private ERR_LOG_NOT_FOUND = 204;
  private ERR_ALREADY_MODERATED = 205;

  private current_block_height = 100;

  // Simulate registry trait
  private verified_farmers = new Set<string>();

  private incrementBlockHeight() {
    this.current_block_height += 1;
  }

  // Mock setting verified
  mock_verify_farmer(farmer: string) {
    this.verified_farmers.add(farmer);
  }

  log_practice(
    caller: string,
    practice_type: string,
    category: string,
    details: string,
    evidence_hash?: string
  ): ClarityResponse<number> {
    if (!this.verified_farmers.has(caller)) {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    if (practice_type.length === 0 || category.length === 0 || details.length === 0) {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    const log_count = (this.state.farmer_log_count.get(caller) ?? 0);
    const key = `${caller}-${log_count}`;
    this.state.practices.set(key, {
      practice_type,
      category,
      timestamp: this.current_block_height,
      details,
      evidence_hash: evidence_hash ?? null,
      moderation_status: "pending",
      moderation_notes: null,
      moderation_timestamp: null,
    });
    this.state.farmer_log_count.set(caller, log_count + 1);
    this.incrementBlockHeight();
    return { ok: true, value: log_count };
  }

  moderate_log(caller: string, farmer: string, log_id: number, status: string, notes?: string): ClarityResponse<boolean> {
    if (caller !== this.state.moderator) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const key = `${farmer}-${log_id}`;
    const log = this.state.practices.get(key);
    if (!log) {
      return { ok: false, value: this.ERR_LOG_NOT_FOUND };
    }
    if (status !== "approved" && status !== "rejected") {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    if (log.moderation_status !== "pending") {
      return { ok: false, value: this.ERR_ALREADY_MODERATED };
    }
    log.moderation_status = status;
    log.moderation_notes = notes ?? null;
    log.moderation_timestamp = this.current_block_height;
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  update_log(caller: string, log_id: number, details: string, evidence_hash?: string): ClarityResponse<boolean> {
    const key = `${caller}-${log_id}`;
    const log = this.state.practices.get(key);
    if (!log) {
      return { ok: false, value: this.ERR_LOG_NOT_FOUND };
    }
    if (log.moderation_status !== "pending") {
      return { ok: false, value: this.ERR_ALREADY_MODERATED };
    }
    log.details = details;
    log.evidence_hash = evidence_hash ?? null;
    return { ok: true, value: true };
  }

  set_moderator(caller: string, new_moderator: string): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.moderator = new_moderator;
    return { ok: true, value: true };
  }

  transfer_ownership(caller: string, new_owner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.contract_owner = new_owner;
    return { ok: true, value: true };
  }

  get_practice(farmer: string, log_id: number): ClarityResponse<PracticeLog | null> {
    const key = `${farmer}-${log_id}`;
    return { ok: true, value: this.state.practices.get(key) ?? null };
  }

  get_farmer_log_count(farmer: string): ClarityResponse<number> {
    return { ok: true, value: this.state.farmer_log_count.get(farmer) ?? 0 };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  farmer1: "farmer1",
  unauthorized: "unauthorized",
};

describe("PracticeLogger Contract", () => {
  let contract: PracticeLoggerMock;

  beforeEach(() => {
    contract = new PracticeLoggerMock();
  });

  it("should allow verified farmer to log practice", () => {
    contract.mock_verify_farmer(accounts.farmer1);
    const result = contract.log_practice(
      accounts.farmer1,
      "Cover Cropping",
      "Soil Health",
      "Planted rye cover crops",
      "hash1234567890abcdef1234567890abcdef"
    );
    expect(result).toEqual({ ok: true, value: 0 });
    const log = contract.get_practice(accounts.farmer1, 0);
    expect(log.value).not.toBeNull();
    expect(log.value).toEqual(expect.objectContaining({
      practice_type: "Cover Cropping",
      moderation_status: "pending",
    }));
  });

  it("should prevent unverified farmer from logging", () => {
    const result = contract.log_practice(
      accounts.farmer1,
      "Cover Cropping",
      "Soil Health",
      "Planted rye cover crops"
    );
    expect(result).toEqual({ ok: false, value: 202 });
  });

  it("should allow moderator to moderate log", () => {
    contract.mock_verify_farmer(accounts.farmer1);
    contract.log_practice(accounts.farmer1, "Cover Cropping", "Soil Health", "Details");
    const result = contract.moderate_log(accounts.deployer, accounts.farmer1, 0, "approved", "Good practice");
    expect(result).toEqual({ ok: true, value: true });
    const log = contract.get_practice(accounts.farmer1, 0);
    expect(log.value).not.toBeNull();
    expect((log.value as PracticeLog).moderation_status).toBe("approved");
    expect((log.value as PracticeLog).moderation_notes).toBe("Good practice");
  });

  it("should prevent non-moderator from moderating", () => {
    contract.mock_verify_farmer(accounts.farmer1);
    contract.log_practice(accounts.farmer1, "Cover Cropping", "Soil Health", "Details");
    const result = contract.moderate_log(accounts.unauthorized, accounts.farmer1, 0, "approved");
    expect(result).toEqual({ ok: false, value: 200 });
  });

  it("should allow farmer to update pending log", () => {
    contract.mock_verify_farmer(accounts.farmer1);
    contract.log_practice(accounts.farmer1, "Cover Cropping", "Soil Health", "Old Details");
    const result = contract.update_log(accounts.farmer1, 0, "New Details", "newhash1234567890abcdef1234567890ab");
    expect(result).toEqual({ ok: true, value: true });
    const log = contract.get_practice(accounts.farmer1, 0);
    expect(log.value).not.toBeNull();
    expect((log.value as PracticeLog).details).toBe("New Details");
  });

  it("should prevent updating moderated log", () => {
    contract.mock_verify_farmer(accounts.farmer1);
    contract.log_practice(accounts.farmer1, "Cover Cropping", "Soil Health", "Details");
    contract.moderate_log(accounts.deployer, accounts.farmer1, 0, "approved");
    const result = contract.update_log(accounts.farmer1, 0, "New Details");
    expect(result).toEqual({ ok: false, value: 205 });
  });

  it("should allow owner to set new moderator", () => {
    const result = contract.set_moderator(accounts.deployer, accounts.farmer1);
    expect(result).toEqual({ ok: true, value: true });
  });
});