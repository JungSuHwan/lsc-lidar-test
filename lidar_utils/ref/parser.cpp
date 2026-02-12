/*
* Copyright (c) 2022, Autonics Co.,Ltd.
* All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions
* are met:
*
*   * Redistributions of source code must retain the above copyright
*     notice, this list of conditions and the following disclaimer.
*
*   * Redistributions in binary form must reproduce the above
*     copyright notice, this list of conditions and the following
*     disclaimer in the documentation and/or other materials provided
*     with the distribution.
*
*   * Neither the name of the Autonics Co.,Ltd nor the names of its
*     contributors may be used to endorse or promote products derived
*     from this software without specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
* "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
* LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
* FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
* COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
* INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
* BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
* LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
* LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
* ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
* POSSIBILITY OF SUCH DAMAGE.
*/



#include <queue>
#include <cstring>
#include <iostream>

#include <memory>

#include "parser.hpp"

#ifdef _MSC_VER
#include <string>
#include <winsock2.h>
#else
#include <arpa/inet.h>
#endif

#include <chrono>


const char* cmd_type_list[NUM_OF_CMD_TYPE] =
{"sMC",
"sMA",
"sRC",
"sRA",
"sWC",
"sWA",
"sCA"
};

const char* cmd_list[NUM_OF_CMD] =
{"None",
"SetAccessLevel",
"SensorScanInfo",
"SensorStart",
"SensorStop",
"ScanData",
"FirstConnectDummySend",
"LSScanDataConfig"
};

AsciiParser::AsciiParser()
{

}

AsciiParser::~AsciiParser()
{

}

std::string AsciiParser::getResponse()
{
    return command_;
}

int AsciiParser::parsingMsg(std::vector<unsigned char> raw_msg, std::shared_ptr<Lsc_t> parsed_data)
{
    uint16_t index= 0;
    int cmd_type = 0, cmd = 0;
    std::vector<char *> field;
    char* ptr;


    if(raw_msg[0] == 0x02)
    {
    #ifdef PRINT_PARSED_DATA
        std::cout << "raw_msg : ";
        for(uint16_t i = 0; i < raw_msg.size(); i++)
        {
            std::cout << raw_msg[i];
        }
        std::cout << "" << std::endl;
    #endif


        ptr = strtok((char*) &raw_msg[1], ",");

        if(raw_msg[strtoul(ptr,NULL, 16) - 1] == 0x03)
        {
            raw_msg[strtoul(ptr, NULL, 16) - 1] = '\0';
        }

        while(ptr != NULL)
        {
            field.push_back(ptr);
            ptr = strtok(NULL, ",");
        }
        index++;

        for(int i = 0; i < NUM_OF_CMD_TYPE; i++)
        {
            int temp_ret = strcmp(field[index], cmd_type_list[i]);

            if(temp_ret == 0)
            {
                cmd_type = i;
                break;
            }
        }
        
        index++;

        command_ = field[index];

        for(int i = 0; i < NUM_OF_CMD; i++)
        {
            if(strcmp(field[index], cmd_list[i]) == 0)
            {
                cmd = i;
                break;
            }
        }
        index++;


        switch(cmd)
        {
            case SENSOR_SCAN_INFO :
                parsed_data->scan_info.angle_start = strtoul(field[6], NULL, 32);
                parsed_data->scan_info.angle_end = strtoul(field[7], NULL, 32);
                parsed_data->scan_info.fw_ver = (uint16_t)strtoul(field[8], NULL, 16);
                parsed_data->scan_info.model_name = field[13];

                #ifdef PRINT_PARSED_DATA
                std::cout << "Command : " << cmd_list[cmd] << std::endl;
                std::cout << "fw_ver : " << parsed_data->scan_info.fw_ver << std::endl;
                std::cout << "Model_name : " << parsed_data->scan_info.model_name << std::endl;
                #endif

                break;

            case SCAN_DATA :
                for(int i = 0; i < NUMBER_OF_PARAM; i++)
                {
                    ptr = strtok(NULL, ",");
                    field.push_back(ptr);
                }

                parsed_data->scan_mea.scan_counter = (uint16_t)strtoul(field[7], NULL, 16);
                parsed_data->scan_mea.scan_freq = (uint16_t)strtoul(field[10], NULL, 16);
                parsed_data->scan_mea.meas_freq = (uint16_t)strtoul(field[11], NULL, 16);
                parsed_data->scan_mea.angle_begin = (int32_t)strtoul(field[12], NULL, 16);
                parsed_data->scan_mea.angle_resol = (uint16_t)strtoul(field[13], NULL, 16);
                parsed_data->scan_mea.amnt_of_data = (uint16_t)strtoul(field[14], NULL, 16);
                index = 16;

                #ifdef PRINT_PARSED_DATA
                std::cout << "Cmd type : " << cmd_type_list[cmd_type] << std::endl;
                std::cout << "Command : " << cmd_list[cmd] << std::endl;
                std::cout << "Scan counter : " << parsed_data->scan_mea.scan_counter << std::endl;
                std::cout << "Scan frequency : " << std::dec << parsed_data->scan_mea.scan_freq << std::endl;
                std::cout << "Measuring frequency : " << parsed_data->scan_mea.meas_freq << std::endl;
                std::cout << "Angle begin : " << parsed_data->scan_mea.angle_begin << std::endl;
                std::cout << "Angle resolution : " << parsed_data->scan_mea.angle_resol << std::endl;
                std::cout << "Amount of data : " << parsed_data->scan_mea.amnt_of_data << std::endl;
                #endif


                parsed_data->scan_mea.ranges.clear();
                if(strcmp(field[index++], "DIST1") == 0)
                {
                    parsed_data->scan_mea.ranges.reserve(parsed_data->scan_mea.amnt_of_data);
                    for(uint16_t i = 0; i < parsed_data->scan_mea.amnt_of_data; i++)
                    {
                        parsed_data->scan_mea.ranges.emplace_back((float) (strtoul(field[index++], NULL, 16) / 1000.0));
                    }

                    #ifdef PRINT_PARSED_DATA
                    std::cout << "ranges : " << std::endl;
                    for(uint16_t i = 0; i < parsed_data->scan_mea.ranges.size(); i++)
                    {
                        std::cout << parsed_data->scan_mea.ranges[i] << " ";
                    }
                    std::cout << "" << std::endl;
                    #endif
                }

                parsed_data->scan_mea.rssi.clear();
                if(field[index] != field.back())
                {
                    if(strcmp(field[index++], "RSSI1") == 0 )
                    {
                        parsed_data->scan_mea.rssi.reserve(parsed_data->scan_mea.amnt_of_data);
                        for(uint16_t i = 0; i < parsed_data->scan_mea.amnt_of_data; i++)
                        {
                            parsed_data->scan_mea.rssi.emplace_back((float) strtoul(field[index++], NULL, 16));
                        }

                        #ifdef PRINT_PARSED_DATA
                        std::cout << "rssi : " << std::endl;
                        for(uint16_t i = 0; i < parsed_data->scan_mea.rssi.size(); i++)
                        {
                            std::cout << parsed_data->scan_mea.rssi[i] << " ";
                        }
                        std::cout << "" << std::endl;
                        #endif
                    }
                }
                break;

            case SCAN_DATA_CONFIG:
                if(cmd_type == 3)
                {
                    parsed_data->scan_data_config.angle_start = strtol(field[3], NULL, 16);
                    parsed_data->scan_data_config.angle_end = strtol(field[4], NULL, 16);
                    parsed_data->scan_data_config.rssi_activate = strtoul(field[5], NULL, 16);
                    parsed_data->scan_data_config.scan_interval = strtoul(field[6], NULL, 16);
                    parsed_data->scan_data_config.fieldset_output_activate = strtoul(field[7], NULL, 16);

                    for(int i = 0; i < field.size(); i++)
                    {
                        std::cout << field[i] << " ";
                    }
                    std::cout << " " << std::endl;                    
                }
                else if(cmd_type == 5)
                {
                    ;
                }
                else
                {
                    std::cout << "command type error " << std::endl;
                }

                break;

            case SENSOR_START :
            case SENSOR_STOP :
            case SET_ACCESS_LEVEL :
            case FIRST_CONNECT_DUMMY_SEND :
                for(std::size_t i = 2; i < field.size(); i++)
                {
                    std::cout << field[i] << " ";
                }
                std::cout << "" << std::endl;
                break;

            default :
                for(std::size_t i = 2; i < field.size(); i++)
                {
                    std::cout << field[i] << " ";
                }
                std::cout << "" << std::endl;
                break;
        }

        raw_msg.clear();
    }

    return 0;
}


// udp
UdpParser::UdpParser()
{
    command_ = "";
    recv_addr = "";
    NetworkInfo = std::make_shared<UdpInfo>();
    NetworkChange = std::make_shared<UdpSet>();
}

UdpParser::~UdpParser()
{
    ;
}

std::string UdpParser::getResponse()
{
    return command_;
}

int UdpParser::parsingMsg(std::vector<unsigned char> raw_msg)
{
    uint16_t  index= 0, l_byte2 = 0;
    int cmd = 0, resp = 0, ret = 0;

    if(raw_msg[0] == 0xF3 && raw_msg[1] == 0xFC)
    {        
        index += 2;

        // get command
        memcpy(&l_byte2, &raw_msg[index], sizeof(l_byte2));
        cmd = htons(l_byte2);
        index += 2;
    
        // get packet size
        index += 2;
        index += 2;

        memset(NetworkInfo->IpAddr, 0x00, sizeof(NetworkInfo->IpAddr));

        if(recv_addr.size() == 0)
        {
            ;
        }
        else
        {
            NetworkInfo->IpAddr[0] = std::stoi(strtok(&recv_addr[0], "."));

            for(int i = 1; i < 4; i++)
            {
                char* temp_tok = strtok(NULL, ".");
                if(temp_tok != NULL)
                {
                    NetworkInfo->IpAddr[i] = std::stoi(temp_tok);
                }
                else
                {
                    break;
                }
            }
        }

        switch(cmd)
        {
            case 1 :
                for(int i = 0; i < 4; i++)
                {
                    NetworkInfo->BroadcastVersion[i] = raw_msg[index];
                    index++;
                }
            
                for(int i = 0; i < 4; i++)
                {
                    memcpy(&l_byte2, &raw_msg[index], sizeof(l_byte2));
                    NetworkInfo->HWVersion[i] = htons(l_byte2);
                    index += 2;
                }
                
                for(int i = 0; i < 4; i++)
                {
                    memcpy(&l_byte2, &raw_msg[index], sizeof(l_byte2));
                    NetworkInfo->SWVersion[i] = htons(l_byte2);
                    index += 2;
                }

                for(int i = 0; i < 4; i++)
                {
                    memcpy(&l_byte2, &raw_msg[index], sizeof(l_byte2));
                    NetworkInfo->FPGAVersion[i] = htons(l_byte2);
                    index += 2;
                }

                for(int i = 0; i < 4; i++)
                {
                    NetworkInfo->SubnetMask[i] = raw_msg[index];
                    index++;
                }

                for(int i = 0; i < 4; i++)
                {
                    NetworkInfo->GateWay[i] = raw_msg[index];
                    index++;
                }

                for(int i = 0; i < 4; i++)
                {
                    NetworkInfo->Port[i] = raw_msg[index];
                    index++;
                }

                for(int i = 0; i < 8; i++)
                {
                    NetworkInfo->MAC[i] = raw_msg[index];
                    index++;
                }

                for(int i = 0; i < 32; i++)
                {
                    if(raw_msg[index] == 0x00)
                    {
                        index += 32 - i;
                        NetworkInfo->ModelName[i] = '\n';
                        break;
                    }
                    else
                    {
                        NetworkInfo->ModelName[i] = raw_msg[index];
                        index++;
                    }
                }

                index += 3;
                NetworkInfo->InUse = raw_msg[index];
                ret = 1;
                
                std::cout << "parsed network info" << std::endl;
                break;

            case 2 :
                index += 3;
                resp = raw_msg[index];

                if(resp == 0)
                {
                    ret = -1;
                    std::cout << "NetWork infomation change failed" << std::endl;
                }
                else if(resp == 1)
                {
                    ret = 1;
                    std::cout << "NetWork infomation change complete" << std::endl;
                }
                else
                {
                    ret = -1;
                    std::cout << "invalied response value : " << resp << std::endl;
                }
                break;

            default :
                std::cout << "invalid cmd value : " << cmd << std::endl;
                break;
        }
    }
    else
    {
        std::cout << "stx isn't matched" << std::endl;
    }

    return ret;
}

unsigned char UdpParser::makeCheckSum(unsigned char* pData, uint16_t nLength)
{
    uint32_t nSum = 0;
    for(int i=0 ; i<nLength; i++) nSum += pData[i];
    return ~(nSum & 0xFF) +1;
}

bool UdpParser::VerifyCheckSum(unsigned char* pData, uint16_t nLength)
{
    uint32_t nSum = 0;
    for(int i=0 ; i<nLength ; i++) nSum += pData[i];
    return ((nSum & 0xFF) == 0);
}

int UdpParser::makeUdpCmd(int cmd, unsigned char* sendbuf, std::shared_ptr<UdpSet> info)
{
    uint32_t length = 0;
    uint8_t checksum = 0;
    int i = 0;
    int index = 0;

    // stx
    sendbuf[index++] = 0xFC;
    sendbuf[index++] = 0xF3;

    // command 
    sendbuf[index++] = 0;
    sendbuf[index++] = cmd;

    // length
    index += 4;

    switch(cmd)
    {
        case 1:
            break;

        case 2:
            // MAC
            for(i = 0; i < 8; i++)
            {
                sendbuf[index++] = info->MAC[i];
            }

            // Old IP
            for(i = 0; i < 4; i++)
            {
                sendbuf[index++] = info->OldIp[i];
            }

            // New IP
            for(i = 0; i < 4; i++)
            {
                sendbuf[index++] = info->NewIp[i];
            }

            // SubnetMask
            for(i = 0; i < 4; i++)
            {
                sendbuf[index++] = info->SubnetMask[i];
            }

            // GateWay
            for(i = 0; i < 4; i++)
            {
                sendbuf[index++] = info->GateWay[i];
            }

            // Port
            for(i = 0; i < 4; i++)
            {
                sendbuf[index++] = info->Port[i];
            }
            break;

        default:
            std::cout << "cmdMake : invalid cmd" << std::endl;
            break;
    }

    // checksum
    index += 4;

    // calculate size
    length = index;

    sendbuf[4] = (length >> 24) & 0xFF;
    sendbuf[5] = (length >> 16) & 0xFF;
    sendbuf[6] = (length >> 8) & 0xFF;
    sendbuf[7] = (length) & 0xFF;

    // calculate checksum
    checksum = makeCheckSum(sendbuf, length);
    sendbuf[length-1] = checksum;

    return length;
}