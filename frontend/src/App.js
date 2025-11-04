import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Contract Configuration - SEPOLIA TESTNET
const CONTRACT_ADDRESS = "0xC24Afe565B6803DdfF004A57d8f65d0404F0836A";
const BACKEND_URL = "http://localhost:5000";
const EXPECTED_CHAIN_ID = "11155111"; // Sepolia

// Contract ABI
const CONTRACT_ABI = [
  "function createOrder(address _seller, string _productName, uint256 _deliveryDays) external payable returns (uint256)",
  "function markShipped(uint256 _orderId, string _otpHash) external",
  "function confirmDelivery(uint256 _orderId, string _otp) external",
  "function refundBuyer(uint256 _orderId) external",
  "function raiseDispute(uint256 _orderId) external",
  "function getBuyerOrders(address _buyer) external view returns (uint256[])",
  "function getSellerOrders(address _seller) external view returns (uint256[])",
  "function getOrder(uint256 _orderId) external view returns (tuple(uint256 orderId, address buyer, address seller, uint256 amount, uint256 createdAt, uint256 deadline, uint8 state, string productName, string otpHash, bool buyerConfirmed, bool sellerConfirmed))",
  "function platformFeePercent() external view returns (uint256)"
];

// Order States
const ORDER_STATES = {
  0: "Created",
  1: "Funded",
  2: "Shipped",
  3: "Delivered",
  4: "Completed",
  5: "Refunded",
  6: "Disputed"
};

function App() {
  const [currentAccount, setCurrentAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [activeTab, setActiveTab] = useState('buyer');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: '' });
  const [platformFee, setPlatformFee] = useState(1);

  const [newOrder, setNewOrder] = useState({
    sellerAddress: '',
    productName: '',
    amount: '',
    deliveryDays: '7',
    buyerEmail: ''
  });

  const [otpInputs, setOtpInputs] = useState({});
  const [buyerEmails, setBuyerEmails] = useState({});

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification({ message: '', type: '' }), 5000);
  };

  const checkMetaMask = () => {
    if (!window.ethereum) {
      showNotification('Please install MetaMask!', 'error');
      return false;
    }
    return true;
  };

  const connectWallet = async () => {
    if (!checkMetaMask()) return;

    try {
      setLoading(true);

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      const chainId = await window.ethereum.request({ method: 'eth_chainId' });

      if (chainId !== `0x${parseInt(EXPECTED_CHAIN_ID).toString(16)}`) {
        showNotification(`Please switch to Sepolia Testnet`, 'warning');
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xaa36a7' }],
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            showNotification('Please add Sepolia network to MetaMask', 'error');
          }
          setLoading(false);
          return;
        }
      }

      const ethersProvider = new ethers.BrowserProvider(window.ethereum);
      const ethersSigner = await ethersProvider.getSigner();

      const contractInstance = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        ethersSigner
      );

      setCurrentAccount(accounts[0]);
      setProvider(ethersProvider);
      setSigner(ethersSigner);
      setContract(contractInstance);

      try {
        const fee = await contractInstance.platformFeePercent();
        setPlatformFee(Number(fee));
      } catch (err) {
        console.log('Using default fee 1%');
      }

      showNotification('Wallet connected to Sepolia!', 'success');

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

    } catch (error) {
      console.error('Error connecting:', error);
      showNotification('Failed to connect wallet', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      setCurrentAccount(null);
      setContract(null);
      showNotification('Wallet disconnected', 'info');
    } else {
      window.location.reload();
    }
  };

  const handleChainChanged = () => {
    window.location.reload();
  };

const fetchOrders = async () => {
  if (!contract || !currentAccount) return;

  setLoading(true);
  try {
    const orderIds = activeTab === 'buyer'
      ? await contract.getBuyerOrders(currentAccount)
      : await contract.getSellerOrders(currentAccount);

    console.log(`Fetched ${orderIds.length} order IDs for ${activeTab}:`, orderIds);

    const ordersData = await Promise.all(
      orderIds.map(async (id) => {
        const order = await contract.getOrder(id);
        console.log(`Order ${id}:`, {
          state: order.state,
          stateName: ORDER_STATES[order.state],
          buyer: order.buyer,
          seller: order.seller
        });
        return {
          orderId: order.orderId.toString(),
          buyer: order.buyer,
          seller: order.seller,
          amount: ethers.formatEther(order.amount),
          createdAt: new Date(Number(order.createdAt) * 1000).toLocaleString(),
          deadline: new Date(Number(order.deadline) * 1000).toLocaleString(),
          deadlineTimestamp: Number(order.deadline),
          state: ORDER_STATES[Number(order.state)],  // ✅ Convert here
          stateNum: Number(order.state),              // ✅ And here
          productName: order.productName,
          otpHash: order.otpHash
        };
      })
    );

    setOrders(ordersData.reverse());
  } catch (error) {
    console.error('Error fetching orders:', error);
    showNotification('Error loading orders', 'error');
  } finally {
    setLoading(false);
  }
};
  const createOrder = async (e) => {
    e.preventDefault();
    if (!contract || !signer) return;

    try {
      const sellerAddress = newOrder.sellerAddress.trim();

      if (!sellerAddress || sellerAddress.length !== 42 || !sellerAddress.startsWith('0x')) {
        showNotification('Invalid address format', 'error');
        return;
      }

      let validatedAddress;
      try {
        validatedAddress = ethers.getAddress(sellerAddress);
      } catch (err) {
        showNotification('Invalid Ethereum address', 'error');
        return;
      }

      if (validatedAddress.toLowerCase() === currentAccount.toLowerCase()) {
        showNotification('Cannot create order with yourself', 'error');
        return;
      }

      if (!newOrder.productName || !newOrder.amount || !newOrder.deliveryDays) {
        showNotification('Please fill all fields', 'error');
        return;
      }

      setLoading(true);

      const tx = await contract.createOrder(
        validatedAddress,
        newOrder.productName.trim(),
        parseInt(newOrder.deliveryDays),
        {
          value: ethers.parseEther(newOrder.amount)
        }
      );

      showNotification('Transaction submitted to Sepolia...', 'info');
      await tx.wait();

      showNotification('Order created successfully!', 'success');

      setNewOrder({
        sellerAddress: '',
        productName: '',
        amount: '',
        deliveryDays: '7',
        buyerEmail: ''
      });

      await fetchOrders();

    } catch (error) {
      console.error('Error creating order:', error);

      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        showNotification('Transaction rejected', 'warning');
      } else if (error.message && error.message.includes('insufficient funds')) {
        showNotification('Insufficient funds - Get Sepolia ETH from faucet', 'error');
      } else {
        showNotification('Failed to create order', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

const markShipped = async (orderId) => {
  if (!contract) return;
  
  const order = orders.find(o => orderId === orderId);
  const buyerEmail =buyerEmails[orderId] || "arasulingam.t@gmail.com";
  setLoading(true);
  try {
    // Generate OTP from backend
    const otpResponse = await fetch(`${BACKEND_URL}/api/generate-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderId.toString(),
        sellerAddress: currentAccount,
        buyerEmail
      })
    });

    const otpData = await otpResponse.json();
    
    if (!otpData.success) {
      throw new Error('Failed to generate OTP');
    }

    // DEBUG: Log OTP details
    console.log('=== MARK SHIPPED DEBUG ===');
    console.log('Order ID:', orderId);
    console.log('OTP from backend:', otpData.devOTP);
    console.log('OTP Hash to send to contract:', otpData.otpHash);
    console.log('OTP Type:', typeof otpData.otpHash);
    console.log('OTP Length:', otpData.otpHash.length);
    console.log('=========================');

    // Call smart contract with plain OTP
    const tx = await contract.markShipped(orderId, otpData.otpHash);
    
    showNotification('Transaction submitted...', 'info');
    await tx.wait();
    
    showNotification(`Order marked as shipped! OTP sent to ${order.buyerEmail}`, 'success');
    await fetchOrders();
    
  } catch (error) {
    console.error('Error marking shipped:', error);
    showNotification('Failed to mark order as shipped', 'error');
  } finally {
    setLoading(false);
  }
};
/*
  const confirmDelivery = async (orderId) => {
    if (!contract) return;

    const otp = otpInputs[orderId] || '';

    if (!otp || otp.length !== 6) {
      showNotification('Please enter 6-digit OTP', 'error');
      return;
    }

    setLoading(true);
try {
      // Get the stored order to see what hash format was stored
      const order = await contract.getOrder(orderId);
//      console.log('Stored OTP Hash:', order.otpHash);
      
      // Hash the OTP the same way backend does
      const tx = await contract.confirmDelivery(orderId, otp);
      
      showNotification('Transaction submitted...', 'info');
      await tx.wait();

      showNotification('Delivery confirmed! Funds released.', 'success');

      await fetch(`${BACKEND_URL}/api/clear-otp/${orderId}`, {
        method: 'DELETE'
      }).catch(console.error);

      setOtpInputs(prev => ({ ...prev, [orderId]: '' }));
      await fetchOrders();

    } catch (error) {
      console.error('Error confirming delivery:', error);
      if (error.message && error.message.includes('Invalid OTP')) {
        showNotification('Invalid OTP', 'error');
      } else {
        showNotification('Failed to confirm delivery', 'error');
      }
    } finally {
      setLoading(false);
    }
  };
*/


const confirmDelivery = async (orderId) => {
  if (!contract) return;
  
  const otp = otpInputs[orderId] || '';
  if (!otp || otp.length !== 6) {
    showNotification('Please enter 6-digit OTP', 'error');
    return;
  }

  setLoading(true);
  try {
    // DEBUG: Check what's stored in contract
    const order = await contract.getOrder(orderId);
    console.log('=== CONFIRM DELIVERY DEBUG ===');
    console.log('Order ID:', orderId);
    console.log('OTP entered by user:', otp);
    console.log('OTP Type:', typeof otp);
    console.log('OTP Length:', otp.length);
    console.log('OTP stored in contract:', order.otpHash);
    console.log('Contract OTP Type:', typeof order.otpHash);
    console.log('Contract OTP Length:', order.otpHash.length);
    console.log('Do they match?', otp === order.otpHash);
    console.log('Keccak256 of entered OTP:', ethers.keccak256(ethers.toUtf8Bytes(otp)));
    console.log('Keccak256 of contract OTP:', ethers.keccak256(ethers.toUtf8Bytes(order.otpHash)));
    console.log('============================');

    // Send plain OTP string - no hashing
    const tx = await contract.confirmDelivery(orderId, otp);
    
    showNotification('Transaction submitted...', 'info');
    await tx.wait();
    showNotification('Delivery confirmed! Funds released.', 'success');
    
    await fetch(`${BACKEND_URL}/api/clear-otp/${orderId}`, {
      method: 'DELETE'
    }).catch(console.error);
    
    setOtpInputs(prev => ({ ...prev, [orderId]: '' }));
    await fetchOrders();
  } catch (error) {
    console.error('Error confirming delivery:', error);
    if (error.message && error.message.includes('Invalid OTP')) {
      showNotification('Invalid OTP. Please check and try again.', 'error');
    } else {
      showNotification('Failed to confirm delivery', 'error');
    }
  } finally {
    setLoading(false);
  }
};

 const requestRefund = async (orderId) => {
    if (!contract) return;
    if (!window.confirm('Request refund? This can only be done after deadline.')) return;

    setLoading(true);
    try {
      const tx = await contract.refundBuyer(orderId);
      showNotification('Processing refund...', 'info');
      await tx.wait();
      showNotification('Refund processed!', 'success');
      await fetchOrders();
    } catch (error) {
      console.error('Error requesting refund:', error);
      showNotification('Failed to process refund', 'error');
    } finally {
      setLoading(false);
    }
  };

  const raiseDispute = async (orderId) => {
    if (!contract) return;
    if (!window.confirm('Raise dispute? Platform will review.')) return;

    setLoading(true);
    try {
      const tx = await contract.raiseDispute(orderId);
      showNotification('Raising dispute...', 'info');
      await tx.wait();
      showNotification('Dispute raised', 'success');
      await fetchOrders();
    } catch (error) {
      console.error('Error raising dispute:', error);
      showNotification('Failed to raise dispute', 'error');
    } finally {
      setLoading(false);
    }
  };

  const isDeadlinePassed = (deadlineTimestamp) => {
    return Date.now() / 1000 > deadlineTimestamp;
  };

  useEffect(() => {
    if (contract && currentAccount) {
      fetchOrders();
    }
  }, [contract, currentAccount, activeTab]);

  useEffect(() => {
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {notification.message && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg ${
          notification.type === 'success' ? 'bg-green-500 text-white' :
          notification.type === 'error' ? 'bg-red-500 text-white' :
          notification.type === 'warning' ? 'bg-yellow-500 text-white' :
          'bg-blue-500 text-white'
        }`}>
          {notification.message}
        </div>
      )}

      <header className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-white text-2xl">🔐</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Crypto Escrow
                </h1>
                <p className="text-xs text-gray-500">Sepolia Testnet</p>
              </div>
            </div>

            {!currentAccount ? (
              <button
                onClick={connectWallet}
                disabled={loading}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-6 py-2 rounded-lg font-medium transition shadow-md disabled:opacity-50"
              >
                {loading ? 'Connecting...' : 'Connect Wallet'}
              </button>
            ) : (
              <div className="flex items-center space-x-3">
                <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                  ● Sepolia
                </div>
                <div className="text-sm text-gray-600 font-mono bg-gray-100 px-3 py-1 rounded-lg">
                  {currentAccount.slice(0, 6)}...{currentAccount.slice(-4)}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {!currentAccount ? (
          <div className="text-center py-20">
            <div className="text-8xl mb-6">🔐</div>
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Secure E-Commerce Payments
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Decentralized escrow on Sepolia testnet with smart contracts and OTP verification
            </p>

            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6 max-w-2xl mx-auto mb-8">
              <p className="text-lg font-semibold text-yellow-800 mb-2">🚰 Need Test ETH?</p>
              <p className="text-sm text-yellow-700 mb-3">Get free Sepolia ETH from these faucets:</p>
              <div className="space-y-2 text-sm">
                <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer"
                   className="block text-blue-600 hover:underline">• sepoliafaucet.com</a>
                <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer"
                   className="block text-blue-600 hover:underline">• Alchemy Sepolia Faucet</a>
                <a href="https://faucet.quicknode.com/ethereum/sepolia" target="_blank" rel="noopener noreferrer"
                   className="block text-blue-600 hover:underline">• QuickNode Faucet</a>
              </div>
            </div>

            <button
              onClick={connectWallet}
              disabled={loading}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-10 py-4 rounded-xl font-medium text-lg transition shadow-lg disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect Wallet to Start'}
            </button>
          </div>
        ) : (
          <div>
            <div className="flex space-x-4 mb-6">
              <button
                onClick={() => setActiveTab('buyer')}
                className={`px-8 py-4 rounded-xl font-semibold transition shadow-md ${
                  activeTab === 'buyer'
                    ? 'bg-white text-indigo-600 ring-2 ring-indigo-600'
                    : 'bg-white/70 text-gray-600 hover:bg-white'
                }`}
              >
                <span className="text-2xl mr-2">🛒</span>
                Buyer Dashboard
              </button>
              <button
                onClick={() => setActiveTab('seller')}
                className={`px-8 py-4 rounded-xl font-semibold transition shadow-md ${
                  activeTab === 'seller'
                    ? 'bg-white text-indigo-600 ring-2 ring-indigo-600'
                    : 'bg-white/70 text-gray-600 hover:bg-white'
                }`}
              >
                <span className="text-2xl mr-2">🏪</span>
                Seller Dashboard
              </button>
            </div>

            {activeTab === 'buyer' && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <span className="mr-2">➕</span> Create New Order
                  </h2>
                  <form onSubmit={createOrder} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Seller Wallet Address *
                        </label>
                        <input
                          type="text"
                          value={newOrder.sellerAddress}
                          onChange={(e) => setNewOrder({ ...newOrder, sellerAddress: e.target.value })}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          placeholder="0x..."
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Product Name *
                        </label>
                        <input
                          type="text"
                          value={newOrder.productName}
                          onChange={(e) => setNewOrder({ ...newOrder, productName: e.target.value })}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          placeholder="e.g., Laptop, Phone"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Amount (ETH) *
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={newOrder.amount}
                          onChange={(e) => setNewOrder({ ...newOrder, amount: e.target.value })}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          placeholder="0.1"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Delivery Days *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={newOrder.deliveryDays}
                          onChange={(e) => setNewOrder({ ...newOrder, deliveryDays: e.target.value })}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          placeholder="7"
                          required
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-6 py-4 rounded-xl font-semibold transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? '⏳ Processing...' : '🚀 Create Order & Lock Funds'}
                    </button>
                  </form>
                </div>

                <div className="bg-white rounded-2xl shadow-xl p-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <span className="mr-2">📦</span> My Orders
                  </h2>
                  {loading && orders.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-4">⏳</div>
                      <p className="text-gray-500">Loading orders...</p>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-6xl mb-4">📭</div>
                      <p className="text-gray-500 text-lg">No orders yet. Create your first order above!</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orders.map((order) => (
                        <div key={order.orderId} className="border-2 border-gray-200 rounded-xl p-6 hover:border-indigo-300 transition">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="font-bold text-xl text-gray-900">{order.productName}</h3>
                              <p className="text-sm text-gray-500">Order #{order.orderId}</p>
                            </div>
                            <span className={`px-4 py-2 rounded-full text-sm font-bold shadow-md ${
                              order.state === 'Completed' ? 'bg-green-100 text-green-800' :
                              order.state === 'Shipped' ? 'bg-blue-100 text-blue-800' :
                              order.state === 'Refunded' ? 'bg-red-100 text-red-800' :
                              order.state === 'Disputed' ? 'bg-orange-100 text-orange-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {order.state}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-4 bg-gray-50 p-4 rounded-lg">
                            <div>
                              <span className="text-gray-500 text-sm">Amount</span>
                              <p className="font-bold text-lg">{order.amount} ETH</p>
                            </div>
                            <div>
                              <span className="text-gray-500 text-sm">Deadline</span>
                              <p className="font-medium text-xs">{order.deadline}</p>
                            </div>
                          </div>

                          {order.stateNum === 2 && (
                            <div className="space-y-3 bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                              <p className="text-sm font-medium text-blue-800 mb-2">
                                📧 Check your email for OTP
                              </p>
                              <input
                                type="text"
                                placeholder="Enter 6-digit OTP"
                                value={otpInputs[order.orderId] || ''}
                                onChange={(e) => setOtpInputs({ ...otpInputs, [order.orderId]: e.target.value })}
                                className="w-full px-4 py-3 border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-center text-lg font-mono"
                                maxLength={6}
                              />
                              <button
                                onClick={() => confirmDelivery(order.orderId)}
                                disabled={loading}
                                className="w-full bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-bold transition shadow-md disabled:opacity-50"
                              >
                                ✅ Confirm Delivery
                              </button>
                            </div>
                          )}

                          <div className="flex gap-2 mt-3">
                            {(order.stateNum === 1 || order.stateNum === 2) && isDeadlinePassed(order.deadlineTimestamp) && (
                              <button
                                onClick={() => requestRefund(order.orderId)}
                                disabled={loading}
                                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
                              >
                                💰 Request Refund
                              </button>
                            )}
                            {(order.stateNum === 2 || order.stateNum === 3) && (
                              <button
                                onClick={() => raiseDispute(order.orderId)}
                                disabled={loading}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
                              >
                                ⚠️ Raise Dispute
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'seller' && (
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                  <span className="mr-2">📥</span> Received Orders
                </h2>

                <div className="mb-4 p-3 bg-gray-100 rounded-lg text-xs">
                  <p><strong>Connected as Seller:</strong> <span className="font-mono">{currentAccount}</span></p>
                  <p><strong>Total Orders:</strong> {orders.length}</p>
                </div>

                {loading && orders.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">⏳</div>
                    <p className="text-gray-500">Loading orders...</p>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">📭</div>
                    <p className="text-gray-500 text-lg">No orders received yet</p>
                    <p className="text-gray-400 text-sm mt-2">Orders will appear here when buyers create orders with your wallet address</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {orders.map((order) => (
                      <div key={order.orderId} className="border-2 border-gray-200 rounded-xl p-6 hover:border-indigo-300 transition">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="font-bold text-xl text-gray-900">{order.productName}</h3>
                            <p className="text-sm text-gray-500">Order #{order.orderId}</p>
                          </div>
                          <span className={`px-4 py-2 rounded-full text-sm font-bold shadow-md ${
                            order.state === 'Completed' ? 'bg-green-100 text-green-800' :
                            order.state === 'Shipped' ? 'bg-blue-100 text-blue-800' :
                            order.state === 'Refunded' ? 'bg-red-100 text-red-800' :
                            order.state === 'Disputed' ? 'bg-orange-100 text-orange-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {order.state}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4 bg-gray-50 p-4 rounded-lg">
                          <div>
                            <span className="text-gray-500 text-sm">Payment</span>
                            <p className="font-bold text-lg">{order.amount} ETH</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-sm">Buyer</span>
                            <p className="font-mono text-xs">{order.buyer.slice(0, 10)}...{order.buyer.slice(-8)}</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-500 text-sm">Current State</span>
                            <p className="font-medium">State #{order.stateNum} - {order.state}</p>
                          </div>
                        </div>

                        {order.stateNum === 0 && (
                          <div className="bg-gray-50 p-4 rounded-lg border-2 border-gray-200">
                            <p className="text-sm font-medium text-gray-800">
                              ⏳ Order created - Waiting for buyer to fund
                            </p>
                          </div>
                        )}

                        {order.stateNum === 1 && (
                          <div className="space-y-3 bg-indigo-50 p-4 rounded-lg border-2 border-indigo-200">
                            <label className="block text-sm font-medium text-indigo-800 mb-2">
                              📧 Enter buyer's email to send OTP:
                            </label>
                            <input
                              type="email"
                              placeholder="buyer@example.com"
                              value={buyerEmails[order.orderId] || ''}
                              onChange={(e) => setBuyerEmails({ ...buyerEmails, [order.orderId]: e.target.value })}
                              className="w-full px-4 py-3 border-2 border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            <button
                              onClick={() => markShipped(order.orderId)}
                              disabled={loading}
                              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-bold transition shadow-md disabled:opacity-50"
                            >
                              {loading ? '⏳ Processing...' : '📦 Mark as Shipped & Send OTP'}
                            </button>
                          </div>
                        )}

                        {order.stateNum === 2 && (
                          <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                            <p className="text-sm font-medium text-blue-800">
                              ✅ Shipped - Waiting for buyer to confirm delivery with OTP
                            </p>
                          </div>
                        )}

                        {order.stateNum === 3 && (
                          <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                            <p className="text-sm font-medium text-blue-800">
                              📦 Delivered - Waiting for final confirmation
                            </p>
                          </div>
                        )}

                        {order.stateNum === 4 && (
                          <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                            <p className="text-sm font-bold text-green-800">
                              💰 Payment received! Order completed successfully.
                            </p>
                          </div>
                        )}

                        {order.stateNum === 5 && (
                          <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                            <p className="text-sm font-bold text-red-800">
                              ⏰ Order refunded to buyer (deadline passed)
                            </p>
                          </div>
                        )}

                        {order.stateNum === 6 && (
                          <div className="bg-orange-50 p-4 rounded-lg border-2 border-orange-200">
                            <p className="text-sm font-bold text-orange-800">
                              ⚠️ Order in dispute - Platform will review
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>🔐 Decentralized Escrow Platform • Built on Sepolia Testnet</p>
          <p className="mt-1">Secure • Trustless • Transparent</p>
          {currentAccount && (
            <p className="mt-2 text-xs">
              Platform Fee: {platformFee}% • Contract: {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
