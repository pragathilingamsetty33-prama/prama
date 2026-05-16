package com.example.prama.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class GroupMessagePacket {
    @JsonProperty("groupId")
    private UUID groupId;
    
    @JsonProperty("senderId")
    private UUID senderId;
    
    @JsonProperty("encryptedContent")
    private String encryptedContent;
    
    @JsonProperty("iv")
    private String iv;
    
    @JsonProperty("tag")
    private String tag;
    
    // Map of Recipient UUID -> RSA-wrapped AES Key
    @JsonProperty("wrappedKeys")
    private Map<UUID, String> wrappedKeys;
}
