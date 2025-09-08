// FarmerRegistry.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface FarmerProfile {
  id: number;
  name: string;
  location: string;
  farm_size: number;
  registration_timestamp: number;
  verification_status: string;
  verification_timestamp: number | null;
  additional_info: string;
  active: boolean;
}

interface ContractState {
  contract_owner: string;
  registration_fee: number;
  verifier: string;
  farmers: Map<string, FarmerProfile>;
  farmer_ids: Map<number, string>;
  next_farmer_id: number;
  contract_balance: number; // Simulate STX balance
}

// Mock contract implementation
class FarmerRegistryMock {
  private state: ContractState = {
    contract_owner: "deployer",
    registration_fee: 1000000,
    verifier: "deployer",
    farmers: new Map(),
    farmer_ids: new Map(),
    next_farmer_id: 1,
    contract_balance: 0,
  };

  private ERR_NOT_AUTHORIZED = 100;
  private ERR_ALREADY_REGISTERED = 101;
  private ERR_INVALID_INPUT = 102;
  private ERR_NOT_REGISTERED = 103;
  private ERR_NOT_VERIFIED = 104;
  private ERR_ALREADY_VERIFIED = 105;
  private ERR_INVALID_STATUS = 106;

  private current_block_height = 100;

  // Simulate block height increase
  private incrementBlockHeight() {
    this.current_block_height += 1;
  }

  register_farmer(
    caller: string,
    name: string,
    location: string,
    farm_size: number,
    additional_info: string
  ): ClarityResponse<number> {
    if (this.state.farmers.has(caller)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    if (name.length === 0 || location.length === 0 || farm_size <= 0) {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    // Simulate fee payment
    this.state.contract_balance += this.state.registration_fee;
    const id = this.state.next_farmer_id;
    this.state.farmers.set(caller, {
      id,
      name,
      location,
      farm_size,
      registration_timestamp: this.current_block_height,
      verification_status: "pending",
      verification_timestamp: null,
      additional_info,
      active: true,
    });
    this.state.farmer_ids.set(id, caller);
    this.state.next_farmer_id += 1;
    this.incrementBlockHeight();
    return { ok: true, value: id };
  }

  verify_farmer(caller: string, farmer: string, status: string): ClarityResponse<boolean> {
    if (caller !== this.state.verifier) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const profile = this.state.farmers.get(farmer);
    if (!profile) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (status !== "verified" && status !== "rejected") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (profile.verification_status !== "pending") {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    profile.verification_status = status;
    profile.verification_timestamp = this.current_block_height;
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  update_profile(
    caller: string,
    name?: string,
    location?: string,
    farm_size?: number,
    additional_info?: string
  ): ClarityResponse<boolean> {
    const profile = this.state.farmers.get(caller);
    if (!profile) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (profile.verification_status !== "verified") {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    if (name) profile.name = name;
    if (location) profile.location = location;
    if (farm_size) profile.farm_size = farm_size;
    if (additional_info) profile.additional_info = additional_info;
    return { ok: true, value: true };
  }

  deactivate_farmer(caller: string, farmer: string): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const profile = this.state.farmers.get(farmer);
    if (!profile) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    profile.active = false;
    return { ok: true, value: true };
  }

  set_registration_fee(caller: string, new_fee: number): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.registration_fee = new_fee;
    return { ok: true, value: true };
  }

  set_verifier(caller: string, new_verifier: string): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.verifier = new_verifier;
    return { ok: true, value: true };
  }

  transfer_ownership(caller: string, new_owner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.contract_owner = new_owner;
    return { ok: true, value: true };
  }

  get_farmer_profile(farmer: string): ClarityResponse<FarmerProfile | null> {
    return { ok: true, value: this.state.farmers.get(farmer) ?? null };
  }

  get_farmer_by_id(id: number): ClarityResponse<FarmerProfile | null> {
    const farmer = this.state.farmer_ids.get(id);
    return { ok: true, value: farmer ? this.state.farmers.get(farmer) ?? null : null };
  }

  get_contract_owner(): ClarityResponse<string> {
    return { ok: true, value: this.state.contract_owner };
  }

  get_registration_fee(): ClarityResponse<number> {
    return { ok: true, value: this.state.registration_fee };
  }

  get_verifier(): ClarityResponse<string> {
    return { ok: true, value: this.state.verifier };
  }

  is_farmer_verified(farmer: string): ClarityResponse<boolean> {
    const profile = this.state.farmers.get(farmer);
    return { ok: true, value: profile ? profile.verification_status === "verified" : false };
  }

  withdraw_fees(caller: string, amount: number): ClarityResponse<boolean> {
    if (caller !== this.state.contract_owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (amount > this.state.contract_balance) {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    this.state.contract_balance -= amount;
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  farmer1: "farmer1",
  farmer2: "farmer2",
  unauthorized: "unauthorized",
};

describe("FarmerRegistry Contract", () => {
  let contract: FarmerRegistryMock;

  beforeEach(() => {
    contract = new FarmerRegistryMock();
  });

  it("should allow registration of a new farmer", () => {
    const result = contract.register_farmer(
      accounts.farmer1,
      "John Doe",
      "Rural Area",
      100,
      "Organic farm"
    );
    expect(result).toEqual({ ok: true, value: 1 });
    const profile = contract.get_farmer_profile(accounts.farmer1);
    expect(profile.ok).toBe(true);
    expect(profile.value).not.toBeNull();
    expect(profile.value).toEqual(expect.objectContaining({
      id: 1,
      name: "John Doe",
      verification_status: "pending",
      active: true,
    }));
  });

  it("should prevent duplicate registration", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.register_farmer(accounts.farmer1, "Jane Doe", "Urban Area", 50, "Tech farm");
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should allow verifier to verify farmer", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.verify_farmer(accounts.deployer, accounts.farmer1, "verified");
    expect(result).toEqual({ ok: true, value: true });
    const profile = contract.get_farmer_profile(accounts.farmer1);
    expect(profile.value).not.toBeNull();
    expect((profile.value as FarmerProfile).verification_status).toBe("verified");
  });

  it("should prevent non-verifier from verifying", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.verify_farmer(accounts.unauthorized, accounts.farmer1, "verified");
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow verified farmer to update profile", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    contract.verify_farmer(accounts.deployer, accounts.farmer1, "verified");
    const result = contract.update_profile(accounts.farmer1, "John Updated", undefined, 150, undefined);
    expect(result).toEqual({ ok: true, value: true });
    const profile = contract.get_farmer_profile(accounts.farmer1);
    expect(profile.value).not.toBeNull();
    expect((profile.value as FarmerProfile).name).toBe("John Updated");
    expect((profile.value as FarmerProfile).farm_size).toBe(150);
  });

  it("should prevent unverified farmer from updating profile", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.update_profile(accounts.farmer1, "John Updated");
    expect(result).toEqual({ ok: false, value: 104 });
  });

  it("should allow owner to deactivate farmer", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.deactivate_farmer(accounts.deployer, accounts.farmer1);
    expect(result).toEqual({ ok: true, value: true });
    const profile = contract.get_farmer_profile(accounts.farmer1);
    expect(profile.value).not.toBeNull();
    expect((profile.value as FarmerProfile).active).toBe(false);
  });

  it("should prevent non-owner from deactivating farmer", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.deactivate_farmer(accounts.unauthorized, accounts.farmer1);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow owner to set new registration fee", () => {
    const result = contract.set_registration_fee(accounts.deployer, 2000000);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.get_registration_fee()).toEqual({ ok: true, value: 2000000 });
  });

  it("should allow owner to withdraw fees", () => {
    contract.register_farmer(accounts.farmer1, "John Doe", "Rural Area", 100, "Organic farm");
    const result = contract.withdraw_fees(accounts.deployer, 1000000);
    expect(result).toEqual({ ok: true, value: true });
  });
});