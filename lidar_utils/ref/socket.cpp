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

#include <iostream>

#ifndef _MSC_VER
#include <unistd.h>
#include <sys/poll.h>
#endif

#include <string.h>
#include <errno.h>

#include <thread>

#include "socket.hpp"


tcpComm::tcpComm()
{
    m_server_sock_ = 0;
    m_connected_ = false;
    rcv_timeout_ = false;
    rcv_error_ = false;
    thread_running_ = false;
}

tcpComm::~tcpComm()
{
    CommDisconnect();
}


void tcpComm::putBufToMsg(unsigned char* buf, uint16_t size)
{
    std::vector<unsigned char> vec;
    vec.reserve(size);

    for(int i = 0; i < size; i++)
    {
        vec.push_back(*(buf+i));
    }
    recvQueue.push(vec);
}


#ifdef _MSC_VER
SOCKET tcpComm::getServerSocket(void)
#else
int tcpComm::getServerSocket(void)
#endif
{
    return m_server_sock_;
}


bool tcpComm::IsConnected(void)
{
    return m_connected_;
}

bool tcpComm::getthreadRunning(void)
{
    return thread_running_;
}


bool tcpComm::getRcvTimeout(void)
{
    return rcv_timeout_;
}

bool tcpComm::getRcvError(void)
{
    return rcv_error_;
}

void tcpComm::setConnected(bool flag)
{
    m_connected_ = flag;
}

void tcpComm::setThreadRunning(bool flag)
{
    thread_running_ = flag;
}

void tcpComm::setRcvTimeout(bool flag)
{
    rcv_timeout_ = flag;
}

void tcpComm::setRcvError(bool flag)
{
    rcv_error_ = flag;
}


void* readCallback(void* arg)
{
    int32_t read_cnt = 0;
    int ret = 0;
    unsigned char r_buffer[16384] = {0, }, temp_len[4] = {0, };
    tcpComm* sock = (tcpComm*) arg;

    std::vector<unsigned char> vec, vec_dataSize; 
    bool flag_stx = false, flag_length = false;
    size_t dataSize = 0;

    vec_dataSize.reserve(5);

#ifdef _MSC_VER
    struct pollfd fd[1];
    fd[0].fd = sock->getServerSocket();
    fd[0].events = POLLIN;
#else
    struct pollfd fd;
    fd.fd = sock->getServerSocket();
    fd.events = POLLIN;
#endif
    sock->setThreadRunning(true);

    while(sock->getthreadRunning())
    {
        read_cnt = 0;
#ifdef _MSC_VER
        ret = WSAPoll(fd, 1, 1000);
#else
        ret = poll(&fd, 1, 1000);
#endif
        if(ret < 0)
        {
            sock->setRcvError(true);
            std::cout << "polling error" << std::endl;
        }
        else /// ret >= 0
        {
            sock->setRcvError(false);

            read_cnt = sock->CommRead(r_buffer, sizeof(r_buffer));

            if(ret == 0)
            {
                sock->setRcvTimeout(true);
            #ifdef PRINT_DEBUG
                std::cout << "polling timeout" << std::endl;
            #endif
            }

            if(read_cnt > 0)
            {
                sock->setRcvTimeout(false);

                for(int i = 0; i < read_cnt; i++)
                {
                    vec.push_back(*(r_buffer + i));

                    if(flag_stx == true)
                    {
                        if(flag_length == true)
                        {
                            if(vec.back() == ETX)
                            {
                                if(dataSize == vec.size())
                                {
                                    sock->recvQueue.push(vec);
                                    vec.clear();
                                    flag_stx = false;
                                    flag_length = false; 
                                    dataSize = 0;
                                }
                                else
                                {
                                    std::cout << "data length mismatched, datasize : " << dataSize << " ,msg size : " << vec.size() << std::endl;
                                    vec.clear();
                                    flag_stx = false;
                                    flag_length = false; 
                                    dataSize = 0;
                                    break;
                                }
                            }
                            else
                            {
                                ;
                            }
                        }
                        else
                        {
                            vec_dataSize.push_back(vec.back());
                            if(vec_dataSize.size() >= 4)
                            {
                                for(int i = 0; i < 4; i++)
                                {
                                    temp_len[i] = vec_dataSize[i];
                                }
                                dataSize = strtoul((const char*) temp_len, NULL, 16);

                                if(dataSize > 0)
                                {
                                    flag_length = true;
                                }
                                else
                                {
                                    std::cout << "invaild data size : " << vec_dataSize.size() << std::endl;
                                }
                            }
                            else
                            {

                            }
                        }
                    }
                    else
                    {
                        if(vec.back() == STX)
                        {
                            vec.clear();
                            vec.push_back(*(r_buffer + i)); 
                            flag_stx = true;

                            vec_dataSize.clear();
                        }
                        else
                        {

                        }
                    }
                }
                memset(r_buffer, 0x00, sizeof(r_buffer));
            }
            else if(read_cnt < 0)    /// disconnect
            {
                std::cout << "server is disconnected" << std::endl;
            }
            else /// receive error
            {
                if(sock->CommWrite(r_buffer, sizeof(r_buffer)))
                {
                    std::cout << "checked connection, server is disconnected" << std::endl;
                    sock->setConnected(false);
                    sock->setThreadRunning(false);
                }
            }
        }
    }

    return 0;
}


void tcpComm::CommDisconnect()
{
    uint16_t bk_cnt = 0;
    thread_running_ = false;

    if(thread_read_.joinable())
    {
        thread_read_.join();
    }

#ifdef _MSC_VER
    closesocket(m_server_sock_);
#else
    while(close(m_server_sock_) !=0 || bk_cnt >= 500)
    {
        bk_cnt++;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

#endif
    if(m_connected_ == true)
    {
        m_connected_ = false;
        std::cout << "disconnect server" << std::endl;
    }
}


int tcpComm::CommConnect(std::string addr, uint16_t port)
{
    int m_server_addr_size = 0;
    timeval tv;
    port_num_ = port;

    m_server_sock_ = socket(PF_INET, SOCK_STREAM, 0);

    if(m_server_sock_ < 0)
    {
        std::cout << "faild to create client socket" << std::endl;
        return -1;
    }

    tv.tv_sec = RS_TIMEOUT_S;
    tv.tv_usec = RS_TIMEOUT_NS;

#ifdef _MSC_VER
    if (setsockopt(m_server_sock_, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv)) < 0)
#else
    if(setsockopt(m_server_sock_, SOL_SOCKET, SO_RCVTIMEO, (char*)&tv, sizeof(tv)) < 0)
#endif
    {
        std::cout << "failed rcvtimeo setsockopt" << std::endl;
    }
#ifdef _MSC_VER
    if (setsockopt(m_server_sock_, SOL_SOCKET, SO_SNDTIMEO, (const char*)&tv, sizeof(tv)) < 0)
#else
    if(setsockopt(m_server_sock_, SOL_SOCKET, SO_SNDTIMEO, (char*)&tv, sizeof(tv)) < 0)
#endif
    {
        std::cout << "failed sndtimeo setsockopt" << std::endl;
    }

    memset(&m_server_addr_, 0x00, sizeof(m_server_addr_));

    m_server_addr_.sin_family = AF_INET;
#ifdef _MSC_VER
    m_server_addr_.sin_addr.s_addr = inet_addr(addr.c_str());
#else
    m_server_addr_.sin_addr.s_addr = inet_addr(addr.begin().base());
#endif
    m_server_addr_.sin_port = htons(port);

    m_server_addr_size = sizeof(m_server_addr_);

    if(connect(m_server_sock_, (const sockaddr*)&m_server_addr_, m_server_addr_size) < 0)
    {
        std::cout << "failed client connect, "<< errno << " " << strerror(errno) << std::endl;
        return -1;
    }
    else
    {
        m_connected_ = true;
        std::cout << "connected " << addr << std::endl;
    }

    try
    {
        thread_read_ = std::thread(readCallback, this);
        std::cout << "thread created" << std::endl;
    }
    catch(const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        std::cout << "thread create failed" << std::endl;
        return -1;
    }

    return 0;
}


int tcpComm::CommRead(unsigned char* buffer, int buf_size)
{
    int read_size = 0;

    if(m_connected_ == true)
    {
        read_size = recv(m_server_sock_, (char *)buffer, buf_size, 0);
        if(read_size < 0)
        {
            std::cout << "client read failed, " << errno << " " << strerror(errno) << std::endl;
            if(errno == 104)    /// connect reset
            {
                thread_running_ = false;
                m_connected_ = false;
                read_size = 0;
            }
            else if(errno == 11)    /// no message received
            {
                read_size = 0;
            }
        }
        else if(read_size == 0)
        {
            std::cout << "server socket has closed" << std::endl;
        }
        else
        {
            ;
        }
    }
    else
    {
        std::cout << "read failed, server is disconnected" << std::endl;
        read_size = -1;
    }

    return read_size;
}


int tcpComm::CommWrite(unsigned char* buffer, int buf_size)
{
    int write_size = 0;

    if(m_connected_ == true)
    {
        write_size = send(m_server_sock_, (const char *)buffer, buf_size, 0);
        if(write_size < 0)
        {
            std::cout << "client write failed, " << errno << " " << strerror(errno) << std::endl;
            if(errno == 104)
            {
                thread_running_ = false;
                m_connected_ = false;
                write_size = 0;
            }
        }
        else if(write_size == 0)
        {
            std::cout << "no byte sent " << errno << " " << strerror(errno) << std::endl;
        }
    }
    else
    {
        std::cout << "write failed, server is disconnected" << std::endl;
        write_size = -1;
    }

    return write_size;
}




udpComm::udpComm()
{
    m_client_sock_ = 0;
    m_connected_ = false;
    rcv_timeout_ = false;
    rcv_error_ = false;
    thread_running_ = false;
}

udpComm::~udpComm()
{
    CommDisconnect();
}

bool VerifyCheckSum(unsigned char* pData, uint16_t nLength)
{
    uint32_t nSum = 0;
    for(int i=0 ; i<nLength ; i++) nSum += pData[i];
    return ((nSum & 0xFF) == 0);
}

void* udpReadCallback(void* arg)
{
    int32_t read_cnt = 0;
    int ret = 0;
    unsigned char r_buffer[200];
    udpComm* sock = (udpComm*) arg;
    
    std::vector<unsigned char> vec, vec_dataSize, vec_cmd; 
    bool flag_stx = false, flag_length = false, flag_cmd = false;
    size_t dataSize = 0;
    uint32_t temp_byte4 = 0;

    vec_cmd.reserve(2);
    vec_dataSize.reserve(4);

#ifdef _MSC_VER
    struct pollfd fd[1];
    fd[0].fd = sock->getClientSocket();
    fd[0].events = POLLIN;
#else
    struct pollfd fd;
    fd.fd = sock->getClientSocket();
    fd.events = POLLIN;
#endif

    sock->setThreadRunning(true);

    while(sock->getthreadRunning())
    {
        read_cnt = 0;
#ifdef _MSC_VER
        ret = WSAPoll(fd, 1, 1000);
#else
        ret = poll(&fd, 1, 1000);
#endif
        if(ret < 0)
        {
            sock->setRcvError(true);
            std::cout << "polling error" << std::endl;
        }
        else /// ret >= 0
        {
            sock->setRcvError(false);

            read_cnt = sock->CommRead(r_buffer, sizeof(r_buffer));

            if(ret == 0)
            {
                sock->setRcvTimeout(true);
            #ifdef PRINT_DEBUG
                std::cout << "polling timeout" << std::endl;
            #endif
            }

            if(read_cnt > 0)
            {
                sock->setRcvTimeout(false);

                for(int i = 0; i < read_cnt; i++)
                {
                    vec.push_back(*(r_buffer + i));
                    
                    if(flag_stx == true)
                    {
                        if(flag_cmd == true)
                        {
                            if(flag_length == true)
                            {
                                if(dataSize == vec.size())
                                {
                                    if(VerifyCheckSum(&vec[0], (uint16_t)vec.size()) == 1)
                                    {
                                        sock->recvQueue.push(vec);
                                        std::cout << "recvaddr : " << sock->recv_ipaddr << std::endl;
                                        sock->pushAddr(sock->recv_ipaddr);
                                        vec.clear();
                                        flag_stx = false;
                                        flag_length = false; 
                                        flag_cmd = false;
                                        dataSize = 0;
                                    }
                                    else
                                    {
                                        std::cout << "checksum mismatched" << std::endl;
                                        vec.clear();
                                        flag_stx = false;
                                        flag_length = false; 
                                        flag_cmd = false;
                                        dataSize = 0;
                                        break;
                                    }
                                }
                                else
                                {
                                    
                                }
                            }
                            else
                            {
                                vec_dataSize.push_back(vec.back());
                                if(vec_dataSize.size() >= 4)
                                {
                                    memcpy(&temp_byte4, &vec_dataSize[0], sizeof(temp_byte4));
                                    dataSize = htonl(temp_byte4);
                                    if(dataSize > 0)
                                    {
                                        flag_length = true;
                                    }
                                    else
                                    {
                                        std::cout << "invaild data size : " << dataSize << std::endl;
                                    }
                                    vec_dataSize.clear();
                                }
                                else
                                {

                                }
                            }
                        }
                        else
                        {
                            vec_cmd.push_back(vec.back());
                            if(vec_cmd.size()>=2)
                            {
                                flag_cmd = true;
                                vec_cmd.clear();
                            }
                        }
                    }
                    else
                    {
                        if(vec.back() == 0xfc)
                        {
                            if(vec.size() >= 2)
                            {
                                if(vec[vec.size()-2] == 0xf3)
                                {
                                    flag_stx = true;
                                    vec.clear();
                                    vec.push_back(*(r_buffer + i - 1));
                                    vec.push_back(*(r_buffer + i));
                                }
                            }
                        }
                        else
                        {
                            
                        }
                    }
                }
                memset(r_buffer, 0x00, sizeof(r_buffer));
            }
            else if(read_cnt < 0)
            {
                ;
            }
            else 
            {
                ;
            }
        }
    }

    return 0;
}

int udpComm::CommConnect(std::string addr, uint16_t port)
{
    int m_server_addr_size = 0, res = 0, on = 1;
    timeval tv;
    port_num_ = port;
    

    m_client_sock_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);

    if(m_client_sock_ < 0)
    {
        std::cout << "faild to create client socket" << std::endl;
        return -1;
    }

    tv.tv_sec = RS_TIMEOUT_S;
    tv.tv_usec = RS_TIMEOUT_NS;

#ifdef _MSC_VER
    setsockopt(m_client_sock_, SOL_SOCKET, SO_BROADCAST, (const char*)&on, sizeof(on)); // broadcast permission
#else
    setsockopt(m_client_sock_, SOL_SOCKET, SO_BROADCAST, &on, sizeof(on)); // broadcast permission
#endif

#ifdef _MSC_VER
    if (setsockopt(m_client_sock_, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv)) < 0)
#else
    if(setsockopt(m_client_sock_, SOL_SOCKET, SO_RCVTIMEO, (char*)&tv, sizeof(tv)) < 0)
#endif
    {
        std::cout << "failed rcvtimeo setsockopt" << std::endl;
    }
#ifdef _MSC_VER
    if (setsockopt(m_client_sock_, SOL_SOCKET, SO_SNDTIMEO, (const char*)&tv, sizeof(tv)) < 0)
#else
    if(setsockopt(m_client_sock_, SOL_SOCKET, SO_SNDTIMEO, (char*)&tv, sizeof(tv)) < 0)
#endif
    {
        std::cout << "failed sndtimeo setsockopt" << std::endl;
    }

    memset(&m_server_addr_, 0x00, sizeof(m_server_addr_));

    m_server_addr_.sin_family = AF_INET;
#ifdef _MSC_VER
    m_server_addr_.sin_addr.s_addr = inet_addr(addr.c_str());
#else
    m_server_addr_.sin_addr.s_addr = inet_addr(addr.begin().base());
#endif
    m_server_addr_.sin_port = htons(port);

    m_server_addr_size = sizeof(m_server_addr_);

    res = bind(m_client_sock_, (sockaddr *) &m_server_addr_, m_server_addr_size);

    if(res < 0)
    {
        std::cout << "failed udp bind, "<< errno << " " << strerror(errno) << std::endl;
        return -1;
    }
    else
    {
        m_connected_ = true;
        std::cout << "udp bind" << std::endl;
    }

    try
    {
        thread_read_ = std::thread(udpReadCallback, this);
        std::cout << "thread created" << std::endl;
    }
    catch(const std::exception& e)
    {
        thread_running_ = false;
        std::cerr << e.what() << '\n';
        std::cout << "thread create failed" << std::endl;
        return -1;
    }

    return 0;
}

void udpComm::CommDisconnect()
{
    uint16_t bk_cnt = 0;
    thread_running_ = false;

    if(thread_read_.joinable())
    {
        thread_read_.join();
    }

#ifdef _MSC_VER
    closesocket(m_client_sock_);
#else
    while(bk_cnt <= 500)
    {
        if(close(m_client_sock_) == 0)
        {
            break;
        }
        bk_cnt++;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

#endif
    if(m_connected_ == true)
    {
        m_connected_ = false;
        std::cout << "disconnect udp" << std::endl;
    }
}

int udpComm::CommRead(unsigned char* buffer, int buf_size)
{
    int read_size = 0;
    sockaddr_in any_addr;
    uint32_t udp_any_addr_size = sizeof(any_addr);
    char* temp;

    if(m_connected_ == true)
    {
#ifdef _MSC_VER
        read_size = recvfrom(m_client_sock_, (char *)buffer, buf_size, 0, (sockaddr*)&any_addr, (int *)&udp_any_addr_size);
#else
        read_size = recvfrom(m_client_sock_, buffer, buf_size, 0, (sockaddr*) &any_addr, &udp_any_addr_size);
#endif
        memset(recv_ipaddr, 0x00, sizeof(recv_ipaddr));
        if(read_size > 0)
        {
            temp = inet_ntoa(any_addr.sin_addr);

            for(int i = 0; i < 30; i++)
            {
                recv_ipaddr[i] = temp[i];
                if(temp[i] == '\n')
                {
                    break;
                }   
            }
        }
        else if(read_size == 0)
        {
            std::cout << "server socket has closed" << std::endl;
        }
    }
    else
    {
        std::cout << "read failed, server is disconnected" << std::endl;
        read_size = -1;
    }

    return read_size;
}

int udpComm::CommWrite(unsigned char* buffer, int buf_size)
{
    int write_size = 0;
    sockaddr_in udp_send_addr;

    udp_send_addr.sin_family = m_server_addr_.sin_family;
    udp_send_addr.sin_port = m_server_addr_.sin_port;
    udp_send_addr.sin_addr.s_addr = htonl(INADDR_BROADCAST); // broadcast

    if(m_connected_ == true)
    {
        write_size = sendto(m_client_sock_, (const char *)buffer, buf_size, 0, (sockaddr*) &udp_send_addr, sizeof(udp_send_addr));
        if(write_size < 0)
        {
            std::cout << "udp write failed, " << errno << " " << strerror(errno) << std::endl;
            if(errno == 104)
            {
                thread_running_ = false;
                m_connected_ = false;
                write_size = 0;
            }
        }
        else if(write_size == 0)
        {
            std::cout << "no byte sent " << errno << " " << strerror(errno) << std::endl;
        }
    }
    else
    {
        std::cout << "write failed, server is disconnected" << std::endl;
        write_size = -1;
    }

    return write_size;
}

#ifdef _MSC_VER
SOCKET udpComm::getClientSocket(void)
#else
int udpComm::getClientSocket(void)
#endif
{
    return m_client_sock_;
}

bool udpComm::IsConnected(void)
{
    return m_connected_;
}

bool udpComm::getthreadRunning(void)
{
    return thread_running_;
}

bool udpComm::getRcvTimeout(void)
{
    return rcv_timeout_;
}

bool udpComm::getRcvError(void)
{
    return rcv_error_;
}

void udpComm::setConnected(bool flag)
{
    m_connected_ = flag;
}

void udpComm::setThreadRunning(bool flag)
{
    thread_running_ = flag;
}

void udpComm::setRcvTimeout(bool flag)
{
    rcv_timeout_ = flag;
}

void udpComm::setRcvError(bool flag)
{
    rcv_error_ = flag;
}

void udpComm::pushAddr(std::string recvaddr)
{
    queue_addr_.push(recvaddr);
}

std::string udpComm::popAddr(void)
{
    std::string addr = "";
    if(!queue_addr_.empty())
    {
        addr = queue_addr_.front();
        queue_addr_.pop();
    }
    else
    {

    }
    
    return addr;
}





