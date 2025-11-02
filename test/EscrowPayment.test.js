const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowPayment", function () {
  let escrow, buyer, seller;
  
  beforeEach(async function () {
    [buyer, seller] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("EscrowPayment");
    escrow = await Escrow.deploy();
  });

  it("Should create order successfully", async function () {
    const tx = await escrow.connect(buyer).createOrder(
      seller.address,
      "Test Product",
      7,
      { value: ethers.parseEther("0.1") }
    );
    await tx.wait();
    
    const order = await escrow.getOrder(1);
    expect(order.buyer).to.equal(buyer.address);
    expect(order.seller).to.equal(seller.address);
  });
});
