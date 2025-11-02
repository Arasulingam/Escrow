// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EscrowPayment
 * @dev Decentralized escrow system for e-commerce with OTP-based delivery confirmation
 */
contract EscrowPayment {
    
    // Enums
    enum OrderState { 
        CREATED,      // Order created but not funded
        FUNDED,       // Payment locked in escrow
        SHIPPED,      // Seller marked as shipped
        DELIVERED,    // Buyer confirmed delivery
        COMPLETED,    // Funds released to seller
        REFUNDED,     // Funds returned to buyer
        DISPUTED      // In dispute state
    }
    
    // Structs
    struct Order {
        uint256 orderId;
        address buyer;
        address seller;
        uint256 amount;
        uint256 createdAt;
        uint256 deadline;        // Auto-refund deadline
        OrderState state;
        string productName;
        string otpHash;          // Hash of OTP for verification
        bool buyerConfirmed;
        bool sellerConfirmed;
    }
    
    // State variables
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public buyerOrders;
    mapping(address => uint256[]) public sellerOrders;
    uint256 public orderCounter;
    uint256 public platformFeePercent = 1; // 1% platform fee
    address public platformWallet;
    
    // Events
    event OrderCreated(uint256 indexed orderId, address indexed buyer, address indexed seller, uint256 amount);
    event OrderFunded(uint256 indexed orderId, uint256 amount);
    event OrderShipped(uint256 indexed orderId, string otpHash);
    event OrderDelivered(uint256 indexed orderId);
    event OrderCompleted(uint256 indexed orderId, uint256 sellerAmount, uint256 platformFee);
    event OrderRefunded(uint256 indexed orderId, uint256 amount);
    event OrderDisputed(uint256 indexed orderId);
    
    // Modifiers
    modifier onlyBuyer(uint256 _orderId) {
        require(orders[_orderId].buyer == msg.sender, "Only buyer can call");
        _;
    }
    
    modifier onlySeller(uint256 _orderId) {
        require(orders[_orderId].seller == msg.sender, "Only seller can call");
        _;
    }
    
    modifier orderExists(uint256 _orderId) {
        require(orders[_orderId].orderId == _orderId, "Order does not exist");
        _;
    }
    
    constructor() {
        platformWallet = msg.sender;
    }
    
    /**
     * @dev Create a new order
     */
    function createOrder(
        address _seller,
        string memory _productName,
        uint256 _deliveryDays
    ) external payable returns (uint256) {
        require(_seller != address(0), "Invalid seller address");
        require(_seller != msg.sender, "Cannot create order with yourself");
        require(msg.value > 0, "Amount must be greater than 0");
        require(_deliveryDays > 0 && _deliveryDays <= 30, "Delivery days must be between 1-30");
        
        orderCounter++;
        uint256 orderId = orderCounter;
        uint256 deadline = block.timestamp + (_deliveryDays * 1 days);
        
        orders[orderId] = Order({
            orderId: orderId,
            buyer: msg.sender,
            seller: _seller,
            amount: msg.value,
            createdAt: block.timestamp,
            deadline: deadline,
            state: OrderState.FUNDED,
            productName: _productName,
            otpHash: "",
            buyerConfirmed: false,
            sellerConfirmed: false
        });
        
        buyerOrders[msg.sender].push(orderId);
        sellerOrders[_seller].push(orderId);
        
        emit OrderCreated(orderId, msg.sender, _seller, msg.value);
        emit OrderFunded(orderId, msg.value);
        
        return orderId;
    }
    
    /**
     * @dev Seller marks order as shipped and sets OTP hash
     */
    function markShipped(uint256 _orderId, string memory _otpHash) 
        external 
        onlySeller(_orderId) 
        orderExists(_orderId) 
    {
        Order storage order = orders[_orderId];
        require(order.state == OrderState.FUNDED, "Order must be in FUNDED state");
        require(bytes(_otpHash).length > 0, "OTP hash required");
        
        order.state = OrderState.SHIPPED;
        order.otpHash = _otpHash;
        
        emit OrderShipped(_orderId, _otpHash);
    }
    
    /**
     * @dev Buyer confirms delivery with OTP
     */
    function confirmDelivery(uint256 _orderId, string memory _otp) 
        external 
        onlyBuyer(_orderId) 
        orderExists(_orderId) 
    {
        Order storage order = orders[_orderId];
        require(order.state == OrderState.SHIPPED, "Order must be in SHIPPED state");
        require(block.timestamp <= order.deadline, "Order deadline passed");
        
        // Verify OTP
        bytes32 otpHash = keccak256(abi.encodePacked(_otp));
        require(keccak256(abi.encodePacked(order.otpHash)) == keccak256(abi.encodePacked(otpHash)), "Invalid OTP");
        
        order.state = OrderState.DELIVERED;
        order.buyerConfirmed = true;
        
        emit OrderDelivered(_orderId);
        
        // Auto-release funds
        releaseFunds(_orderId);
    }
    
    /**
     * @dev Release funds to seller (called internally after delivery confirmation)
     */
    function releaseFunds(uint256 _orderId) internal {
        Order storage order = orders[_orderId];
        require(order.state == OrderState.DELIVERED, "Order must be delivered");
        
        uint256 platformFee = (order.amount * platformFeePercent) / 100;
        uint256 sellerAmount = order.amount - platformFee;
        
        order.state = OrderState.COMPLETED;
        
        // Transfer funds
        payable(order.seller).transfer(sellerAmount);
        payable(platformWallet).transfer(platformFee);
        
        emit OrderCompleted(_orderId, sellerAmount, platformFee);
    }
    
    /**
     * @dev Refund buyer if deadline passed without delivery confirmation
     */
    function refundBuyer(uint256 _orderId) 
        external 
        orderExists(_orderId) 
    {
        Order storage order = orders[_orderId];
        require(
            order.state == OrderState.FUNDED || order.state == OrderState.SHIPPED,
            "Order not eligible for refund"
        );
        require(block.timestamp > order.deadline, "Deadline not passed yet");
        require(msg.sender == order.buyer || msg.sender == platformWallet, "Not authorized");
        
        order.state = OrderState.REFUNDED;
        
        payable(order.buyer).transfer(order.amount);
        
        emit OrderRefunded(_orderId, order.amount);
    }
    
    /**
     * @dev Raise a dispute
     */
    function raiseDispute(uint256 _orderId) 
        external 
        orderExists(_orderId) 
    {
        Order storage order = orders[_orderId];
        require(
            msg.sender == order.buyer || msg.sender == order.seller,
            "Only buyer or seller can raise dispute"
        );
        require(
            order.state == OrderState.SHIPPED || order.state == OrderState.DELIVERED,
            "Invalid state for dispute"
        );
        
        order.state = OrderState.DISPUTED;
        
        emit OrderDisputed(_orderId);
    }
    
    /**
     * @dev Resolve dispute (only platform admin)
     */
    function resolveDispute(uint256 _orderId, bool _refundBuyer) 
        external 
        orderExists(_orderId) 
    {
        require(msg.sender == platformWallet, "Only platform can resolve");
        Order storage order = orders[_orderId];
        require(order.state == OrderState.DISPUTED, "Order not in dispute");
        
        if (_refundBuyer) {
            order.state = OrderState.REFUNDED;
            payable(order.buyer).transfer(order.amount);
            emit OrderRefunded(_orderId, order.amount);
        } else {
            order.state = OrderState.COMPLETED;
            uint256 platformFee = (order.amount * platformFeePercent) / 100;
            uint256 sellerAmount = order.amount - platformFee;
            payable(order.seller).transfer(sellerAmount);
            payable(platformWallet).transfer(platformFee);
            emit OrderCompleted(_orderId, sellerAmount, platformFee);
        }
    }
    
    /**
     * @dev Get buyer's orders
     */
    function getBuyerOrders(address _buyer) external view returns (uint256[] memory) {
        return buyerOrders[_buyer];
    }
    
    /**
     * @dev Get seller's orders
     */
    function getSellerOrders(address _seller) external view returns (uint256[] memory) {
        return sellerOrders[_seller];
    }
    
    /**
     * @dev Get order details
     */
    function getOrder(uint256 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }
    
    /**
     * @dev Update platform fee (only admin)
     */
    function updatePlatformFee(uint256 _newFeePercent) external {
        require(msg.sender == platformWallet, "Only platform admin");
        require(_newFeePercent <= 5, "Fee too high");
        platformFeePercent = _newFeePercent;
    }
    
    /**
     * @dev Get contract balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
