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


#include <sstream>
#include <thread>

#include <chrono>
#include <string>
#include <functional>

#ifndef _MSC_VER
#include <sys/ioctl.h>
#include <net/if.h>
#endif

#include "autolidar.hpp"

using namespace std::chrono_literals;

extern const char* cmd_type_list[NUM_OF_CMD_TYPE];
extern const char* cmd_list[NUM_OF_CMD];

Autolidar::Autolidar(): Node("autonics_lsc_lidar")
#ifdef USE_DIAGNOSTICS
, diagnostic_updater_laser_(this)
#endif
{
  ip_addr = "192.168.0.1";
  frame_id = "laser";
  pub_topic = "scan";
  password = "0000";
  prev_addr = "";
  new_addr = "";
  port_number = 8000;
  diagnostics_windows_time = 1;
  angle_min = -45;
  angle_max = 225;
  angle_offset = 0;
  range_min = 0;
  range_max = 25;
  diagnostics_tolerance = 0.1;
  intensities = true;
  ip_change = false;
}

Autolidar::~Autolidar()
{
}

void Autolidar::setCommType(std::shared_ptr<Communication> comm_type)
{
  comm_ = comm_type;
}

void Autolidar::setParser(std::shared_ptr<Parser> parser)
{
  parser_ = parser;
}


unsigned char Autolidar::itohascii(unsigned char input)
{
  unsigned char ret = 0;

  if(input < 10)
  {
    ret = input + '0';
  }
  else if(input < 16)
  {
    ret = input-10 + 'A';
  }
  else
  {
    ret = 255;
    RCLCPP_INFO(this->get_logger(), "out of hex range");
  }

  return ret;
}

int Autolidar::makeCommand(std::vector<unsigned char>& v_cmd_frame, std::string cmd)
{
    uint8_t cmd_num = 0;
    size_t cmd_size = 0;
    std::string temp_str;
    char* ptr_tok_cmd;

    v_cmd_frame.reserve(40);
    v_cmd_frame.resize(5);
    v_cmd_frame[0] = 2;
    v_cmd_frame.push_back(',');

    temp_str = cmd;
    ptr_tok_cmd = strtok(&temp_str[0], ",");

    for(cmd_num = 0; cmd_num < NUM_OF_CMD; cmd_num++)
    {
        if(strcmp(cmd_list[cmd_num], ptr_tok_cmd) == 0)
        {
            break;
        }
    }

    switch(cmd_num)
    {
        case SET_ACCESS_LEVEL :
        case SENSOR_START :
        case SENSOR_STOP :
            v_cmd_frame.push_back('s');
            v_cmd_frame.push_back('M');
            v_cmd_frame.push_back('C');
            break;

        case SENSOR_SCAN_INFO :
        case SCAN_DATA_CONFIG :
            v_cmd_frame.push_back('s');
            v_cmd_frame.push_back('R');
            v_cmd_frame.push_back('C');
            break;

        case NONE :
        default :
            RCLCPP_INFO(this->get_logger(), "invalid command, type correct command %d", cmd_num);
            return -1;
            break;
    }
    v_cmd_frame.push_back(',');
    v_cmd_frame.insert(v_cmd_frame.end(), cmd.begin(), cmd.end());
    v_cmd_frame.push_back(3);
    cmd_size = v_cmd_frame.size();

    v_cmd_frame[4] = itohascii(cmd_size%16);
    for(uint8_t i = 3; i > 0; i--)
    {
        cmd_size /= 16;
        v_cmd_frame[i] = itohascii((unsigned char)cmd_size);
    }

    #ifdef PRINT_PARSED_DATA
    std::cout << "cmd_struct : ";
    for(uint16_t i = 0; i < v_cmd_frame.size(); i++)
    {
        std::cout << v_cmd_frame[i];
    }
    std::cout << "" << std::endl;
    #endif

    return (int)v_cmd_frame.size();
}

int Autolidar::get_response(std::string cmd)
{
  uint16_t cnt = 0;
  while(cnt < RESPONS_WAIT_CNT)
  {
    if(!comm_->recvQueue.empty())
    {
      parser_->parsingMsg(comm_->recvQueue.front(), lsc_);
      comm_->recvQueue.pop();

      if(strcmp(cmd.c_str(), parser_->getResponse().c_str()) == 0)
      {
        std::cout << "get response : " << cmd.c_str() << std::endl;
        break;
      }
      else
      {

      }
    }
    cnt++;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    if(cnt >= RESPONS_WAIT_CNT)
    {
      RCLCPP_INFO(this->get_logger(), "getting response failed, count : %d", cnt);
      return -1;
    }
  }
  return 0;
}

int8_t Autolidar::send_command(std::string cmd)
{
  std::vector<unsigned char> cmd_struct;

  int cmd_size = 0;
  uint8_t try_send_cnt = 0;
  int8_t ret = -1;
  char* ptr_tok_cmd;

  cmd_size = makeCommand(cmd_struct, cmd);
  ptr_tok_cmd = strtok(&cmd[0], ",");

  do{
    comm_->CommWrite(&cmd_struct[0], cmd_size);
    try_send_cnt++;

    if(get_response(ptr_tok_cmd) == 0)
    {
      ret = 0;
      break;
    }
    else
    {
      ;
    }

  }while(try_send_cnt < 3);

  return ret;
}

#ifdef USE_DIAGNOSTICS
void Autolidar::check_connection(diagnostic_updater::DiagnosticStatusWrapper & stat)
{
  if(comm_->IsConnected())
  {
    stat.summary(diagnostic_msgs::msg::DiagnosticStatus::OK, "connection is ok");
  }
  else
  {
#ifdef _MSC_VER
    stat.summary(2, "lost connection");
#else
    stat.summary(diagnostic_msgs::msg::DiagnosticStatus::ERROR, "lost connection");
#endif
  }
}
#endif

rcl_interfaces::msg::SetParametersResult
 Autolidar::param_callback(const std::vector<rclcpp::Parameter> &parameters)
{
  rcl_interfaces::msg::SetParametersResult result;
  result.successful = true;
  result.reason = "success";

  for (const auto &param : parameters)
  {
    std::string param_name = param.get_name();
    rclcpp::ParameterType param_type = param.get_type();

    if(param_name == "frame_id")
    {
      if(param_type != rclcpp::ParameterType::PARAMETER_STRING)
      {
        result.successful = false;
        result.reason = "parameter type is not string, ex) laser";
      }
      else
      {
        frame_id = param.as_string();
      }
    }
    else if(param_name == "range_min")
    {
      if(param_type != rclcpp::ParameterType::PARAMETER_DOUBLE)
      {
        result.successful = false;
        result.reason = "parameter type is not double, ex) 0.05";
      }
      else if (param.as_double() > range_max)
      {
        result.successful = false;
        result.reason = "range_min must be lower value than range_max";
      }
      else if (param.as_double() < 0.05)
      {
        result.successful = false;
        result.reason = "range_min must be upper than 0.05";
      }
      else
      {
        range_min = param.as_double();
      }
    }
    else if(param_name == "range_max")
    {
      if(param_type != rclcpp::ParameterType::PARAMETER_DOUBLE)
      {
        result.successful = false;
        result.reason = "parameter type is not double, ex) 25.0";
      }
      else if (param.as_double() < range_min)
      {
        result.successful = false;
        result.reason = "range_max must be upper value than range_min";
      }
      else if (param.as_double() > 25.0)
      {
        result.successful = false;
        result.reason = "range_max must be lower than 25.0";
      }
      else
      {
        range_max = param.as_double();
      }
    }
    else if(param_name == "intensities")
    {
      if(param_type != rclcpp::ParameterType::PARAMETER_BOOL)
      {
        result.successful = false;
        result.reason = "parameter type is not bool, ex) true";
      }
      else
      {
        intensities = param.as_bool();
        lsc_->scan_data_config.rssi_activate = intensities;
        setScanAngle();
      }
    }
    else if(param_name == "diagnostics_tolerance" || param_name == "diagnostics_windows_time")
    {
        result.successful = false;
        result.reason = "this parameter is static, go to launch file to change this";
    }
    else
    {

    }
  }

  return result;
}

template<typename T>
bool Autolidar::declearParam(std::string name, T value)
{
  if(this->has_parameter(name) != true)
  {
    this->declare_parameter<T>(name, value);
    return true;
  }
  else
  {
    return false;
  }

}

int Autolidar::login(std::string password)
{
  std::string cmd = "SetAccessLevel";
  std::string login_cmd = cmd + "," + password;

  send_command(login_cmd);

  return 0;
}

std::string Autolidar::searchMatchedAddr(std::string std_addr, std::vector<std::string> ip_list)
{
  std::vector<std::string> tok_std_addr, tok_ip_list;
  std::string matched_addr, str_iplist;
  char* temp_cmp;
  size_t tcnt = 0;

  tok_std_addr.clear();
  tok_std_addr.push_back(strtok(&std_addr[0], "."));
  while(1)
  {
    char* temp_tok = strtok(NULL, ".");
    if(temp_tok != NULL)
    {
      tok_std_addr.push_back(temp_tok);
    }
    else
    {
        break;
    }
  }

  if(tok_std_addr.size() != 4)
  {
    std::cout << "invalid ip addr" << std::endl;
    return NULL;
  }

  for(size_t i = 0; i < ip_list.size(); i++)
  {
    tok_ip_list.clear();
    
    temp_cmp = strtok(&((ip_list[i])[0]), ".");
    if(temp_cmp != NULL)
    {
      tok_ip_list.push_back(temp_cmp);
    }

    while(1)
    {   
      char* temp_cmp = strtok(NULL, ".");                
      if(temp_cmp != NULL)
      {
        tok_ip_list.push_back(temp_cmp);
      }
      else
      {
        break;
      }
    }

    for(int j = 0; j < 3; j++)
    {
      if(tok_std_addr[j] != tok_ip_list[j])
      {
          break;
      }
      else
      {
        if(j >= 2)
        {
          while(1)
          {
            matched_addr += tok_ip_list[tcnt++];
            if(tcnt >= tok_ip_list.size())
            {
                break;
            }
            matched_addr += ".";
          }
          
          return matched_addr;
        }
      }
    }
  }

  return "none";
}

std::string Autolidar::searchClientip(std::string baseAddr)
{
  std::string sip_addr;
  int temp_sock = 0;
  std::vector<std::string> v_ipaddr;
  std::string clientIp = "";

#ifdef _MSC_VER
  char ac[80];
  gethostname(ac, sizeof(ac));
  struct hostent* phe = gethostbyname(ac);
  struct in_addr addr;

  if (phe != 0)
  {
      for (int i = 0; phe->h_addr_list[i] != 0; ++i)
      {
          memcpy(&addr, phe->h_addr_list[i], sizeof(struct in_addr));
          v_ipaddr.push_back(inet_ntoa(addr));
      }
  }
#else
  struct sockaddr_in* sin;
  struct ifconf ifcfg;
  memset(&ifcfg, 0, sizeof(ifcfg));

  ifcfg.ifc_buf = NULL;
  const int ifc_len = sizeof(struct ifreq) * 10;
  ifcfg.ifc_len = ifc_len;

  char addbuff[ifc_len] = {0,};
  ifcfg.ifc_buf = addbuff;

  temp_sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);

  if(ioctl(temp_sock, SIOCGIFCONF,(char*)&ifcfg)<0)
  {
    perror("SIOCGIFCONF ");
    std::cout << "siocgifconf error" << std::endl;
    return NULL;
  }

  for(int n = 0; n < ifcfg.ifc_len; n += sizeof(struct ifreq))
  {
    sin = (struct sockaddr_in*)&ifcfg.ifc_req->ifr_addr;
    v_ipaddr.push_back(inet_ntoa(sin->sin_addr));
    ifcfg.ifc_req++;
  }
#endif
  sip_addr = searchMatchedAddr(baseAddr, v_ipaddr);
  if(sip_addr == "none")
  {
    std::cout << "no matched ip address, please check device is turned on" << std::endl;
    return "";
  }

  std::vector<std::string> tok_sip_addr;
  tok_sip_addr.push_back(strtok(&sip_addr[0], "."));

  while(1)
  {
    char* temp_tok = strtok(NULL, ".");
    if(temp_tok != NULL)
    {
        tok_sip_addr.push_back(temp_tok);
    }
    else
    {
        break;
    }
  }
  
  uint64_t vcnt = 0;
  while(1)
  {
    clientIp += tok_sip_addr[vcnt++];
    if(vcnt >= tok_sip_addr.size())
    {
        break;
    }
    clientIp += ".";
  }
  std::cout << "udp_client_ip : " << clientIp << std::endl;

  return clientIp;
}

int Autolidar::addrChange()
{
  std::string udp_client_ip = "", recv_addr = "", temp_new_ip = "";
  bool flag_ipChageOnProcess = false;
  IPCHANGE_STAT ic_stat = NONE;
  int try_esteps = 0;
  const size_t buff_size = 100;
  unsigned char cmd_buff[buff_size];
  uint8_t cmd_buff_len = 0, len_send = 0;
  int ret = 0, recv_check = 0;

  std::shared_ptr<udpComm> udpsock = std::make_shared<udpComm>();
  std::shared_ptr<UdpParser> udpparser = std::make_shared<UdpParser>();

  udp_client_ip = searchClientip(prev_addr);     
  
  if(udp_client_ip != "")
  {
    if(udpsock->CommConnect(udp_client_ip, 55555) < 0)
    {
      std::cout << "failed to connect udp" << std::endl;
      ret = -1;
    }
    else
    {
      flag_ipChageOnProcess = true;
      ic_stat = RQ_INFO;

      while(flag_ipChageOnProcess)
      {
        switch(ic_stat)
        {
          case NONE:
              break;

          case RQ_INFO:
            memset(cmd_buff, 0x00, buff_size);
            cmd_buff_len = udpparser->makeUdpCmd(1, cmd_buff, udpparser->NetworkChange);
            len_send= udpsock->CommWrite(cmd_buff, cmd_buff_len);
            try_esteps++;

            if(len_send > 0)
            {
              try_esteps = 0;
              ic_stat = GET_INFO;
            }
            else
            {    
              std::cout << "udp send failed, error no : " << strerror(errno) << std::endl;
              std::cout << "retry : " << try_esteps << std::endl;
              if(try_esteps > 10)
              {
                std::cout << "ip change failed, error no : " << strerror(errno) << std::endl;
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
              }
            }
            break;

          case GET_INFO:
            try_esteps++;
            if(!udpsock->recvQueue.empty())
            {
              recv_addr = udpsock->popAddr();
              udpparser->recv_addr = recv_addr;
              std::cout << "recv_addr : " << recv_addr << std::endl;
              recv_check = udpparser->parsingMsg(udpsock->recvQueue.front());
              udpsock->recvQueue.pop();

              // add ack check
              if(recv_check > 0 && recv_addr == prev_addr)
              {
                try_esteps = 0;
                ic_stat = INFO_CHANGE;
              }
              else if(recv_check > 0 && recv_addr == new_addr)
              {
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
                ip_addr = recv_addr;
                std::cout << "ip is matched with new_addr" << std::endl;
              }
              else
              {
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
                std::cout << "get network info failed" << std::endl;
                std::cout << "please chech ip address" << std::endl;
              }
            }
            else
            {
              std::cout << "messgeQueue is empty, retry : " << try_esteps << std::endl;
              if(try_esteps > 10)
              {
                std::cout << "getting info failed, error no : " << strerror(errno) << std::endl;
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
              }
            }
            break;

          case INFO_CHANGE:
            temp_new_ip = new_addr;
            std::cout << "port_number : " << port_number << std::endl;
            udpparser->NetworkInfo->Port[0] = 0;
            udpparser->NetworkInfo->Port[1] = 0;
            udpparser->NetworkInfo->Port[2] = port_number/0xFF;
            udpparser->NetworkInfo->Port[3] = port_number & 0xFF;
          
            udpparser->NetworkChange->NewIp[0] = std::stoi(strtok(&temp_new_ip[0], "."));
            for(int i = 1; i < 4; i++)
            {
              char* temp_tok = strtok(NULL, ".");
              if(temp_tok != NULL)
              {
                  udpparser->NetworkChange->NewIp[i] = std::stoi(temp_tok);
              }
              else
              {
                  break;
              }
            }

            for(int i = 0; i < 8; i++)
            {
              udpparser->NetworkChange->MAC[i] = udpparser->NetworkInfo->MAC[i];
            }
            for(int i = 0; i < 4; i++)
            {
              udpparser->NetworkChange->OldIp[i] = udpparser->NetworkInfo->IpAddr[i];
              udpparser->NetworkChange->SubnetMask[i] = udpparser->NetworkInfo->SubnetMask[i];
              udpparser->NetworkChange->GateWay[i] = udpparser->NetworkInfo->GateWay[i];
              udpparser->NetworkChange->Port[i] = udpparser->NetworkInfo->Port[i];
            }

            memset(cmd_buff, 0x00, buff_size);
            cmd_buff_len = udpparser->makeUdpCmd(2, cmd_buff, udpparser->NetworkChange);
            len_send= udpsock->CommWrite(cmd_buff, cmd_buff_len);
            try_esteps++;

            if(len_send > 0)
            {
              try_esteps = 0;
              ic_stat = GET_RESP;
            }
            else
            {    
              std::cout << "info change failed, error no : " << strerror(errno) << std::endl;
              std::cout << "retry : " << try_esteps << std::endl;
              if(try_esteps > 10)
              {
                  std::cout << "ip change failed, error no : " << strerror(errno) << std::endl;
                  try_esteps = 0;
                  ic_stat = NONE;
                  flag_ipChageOnProcess = false;
              }
            }
            break;

          case GET_RESP:
            try_esteps++;
            if(!udpsock->recvQueue.empty())
            {
              recv_addr = udpsock->popAddr();
              udpparser->recv_addr = recv_addr;
              recv_check = udpparser->parsingMsg(udpsock->recvQueue.front());
              udpsock->recvQueue.pop();

              // add ack check
              if(recv_check > 0)
              {
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
                std::cout << "ip change complete" << std::endl;
                ip_addr = new_addr;
                // wait applying changed ip
                std::this_thread::sleep_for(std::chrono::milliseconds(2000));
              }
              else
              {
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
                std::cout << "ip change failed" << std::endl;
              }
            }
            else
            {
              std::cout << "messgeQueue is empty, retry : " << try_esteps << std::endl;
              if(try_esteps > 10)
              {
                std::cout << "getting response failed, error no : " << strerror(errno) << std::endl;
                try_esteps = 0;
                ic_stat = NONE;
                flag_ipChageOnProcess = false;
              }
            }
            break;

          default:
            ic_stat = NONE;
            flag_ipChageOnProcess = false;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
      }
      udpsock->CommDisconnect();
    }
  }
  else
  {
    ret = -1;
      std::cout << "failed to get ip address" << std::endl;
  }

  return ret;
}

int Autolidar::setScanAngle()
{
  char buff[60] = {0,};
  memset(buff, 0x00, sizeof(buff));
  int ret = -1, try_send_cnt = 0, cmd_size = 0;
  size_t temp_cmd_size = 0;

  buff[0] = 0x02;
  buff[1] = '0';
  buff[2] = '0';
  buff[3] = '0';
  buff[4] = '0';

  sprintf(&buff[5], ",sWC,LSScanDataConfig,%X,%X,%X,%X,%X\x03",\
  (int) std::round((angle_min - angle_offset) * 10000),\
  (int) std::round((angle_max - angle_offset) * 10000),\
  lsc_->scan_data_config.rssi_activate,\
  lsc_->scan_data_config.scan_interval,\
  lsc_->scan_data_config.fieldset_output_activate);

  temp_cmd_size = strlen(buff);
  cmd_size = (int)temp_cmd_size;
  buff[4] = (char)itohascii(temp_cmd_size%16);

  for(uint8_t i = 3; i > 0; i--)
  {
      temp_cmd_size /= 16;
      buff[i] = (char)itohascii((unsigned char)temp_cmd_size);
  }
  
  do{
    comm_->CommWrite((unsigned char* )&buff[0], cmd_size);
    try_send_cnt++;

    if(get_response("LSScanDataConfig") == 0)
    {
      ret = 0;
      break;
    }
    else
    {
      ;
    }
  }while(try_send_cnt < 3);

  return ret;
}


void Autolidar::publish_laserscan(std::shared_ptr<sensor_msgs::msg::LaserScan> msg, std::shared_ptr<Lsc_t> lsc)
{
  msg->header.frame_id = frame_id;
  msg->range_max = (float) range_max;
  msg->range_min = (float) range_min;
  msg->header.stamp = this->now();
  msg->angle_min = (float) (lsc->scan_mea.angle_begin / 10000.0 * DEG2RAD) + (angle_offset * DEG2RAD);
  msg->angle_increment = (float) (lsc->scan_mea.angle_resol / 10000.0 * DEG2RAD);
  msg->angle_max = msg->angle_min + (lsc->scan_mea.amnt_of_data - 1) * msg->angle_increment;
  msg->time_increment = (msg->scan_time / lsc->scan_mea.amnt_of_data);
  msg->scan_time = (1.0 / (lsc->scan_mea.scan_freq / 100.0));

  msg->ranges.reserve(lsc->scan_mea.ranges.size());

  for(uint16_t i=0; i < lsc->scan_mea.ranges.size(); i++)
  {
    msg->ranges.emplace_back(lsc->scan_mea.ranges[i]);
  }

  if(intensities)
  {
    if(!lsc->scan_mea.rssi.empty())
    {
      msg->intensities.reserve(lsc->scan_mea.rssi.size());
      for(uint16_t i=0; i < lsc->scan_mea.rssi.size(); i++)
      {
        msg->intensities.emplace_back(lsc->scan_mea.rssi[i]);
      }
    }
  }

  laser_topic_publisher_->publish(*msg);

  msg->ranges.clear();
  msg->intensities.clear();
}

void Autolidar::lsc_init()
{
  lsc_->scan_info.angle_start = (angle_min - angle_offset) * 10000;
  lsc_->scan_info.angle_end = (angle_max - angle_offset) * 10000;
  lsc_->scan_info.fw_ver = 0;
  lsc_->scan_info.model_name = "LSC-270";

  lsc_->scan_mea.scan_counter = 0;
  lsc_->scan_mea.scan_freq = 1500;
  lsc_->scan_mea.meas_freq = 0;
  lsc_->scan_mea.angle_begin = (angle_min - angle_offset) * 10000;
  lsc_->scan_mea.angle_resol = 3333;
  lsc_->scan_mea.amnt_of_data = 0;
  lsc_->scan_mea.active_field_num = 0;
  lsc_->scan_mea.ranges.clear();
  lsc_->scan_mea.rssi.clear();

  lsc_->scan_data_config.angle_start = (angle_min - angle_offset) * 10000;
  lsc_->scan_data_config.angle_end = (angle_max - angle_offset) * 10000;
  lsc_->scan_data_config.rssi_activate = 1;
  lsc_->scan_data_config.scan_interval = 67;
  lsc_->scan_data_config.fieldset_output_activate = 1;
}

int Autolidar::init()
{
  uint16_t reconnect_cnt = 0;

  declearParam<std::string>("addr", "192.168.0.1");
  declearParam<uint16_t>("port", 8000);
  declearParam<std::string>("frame_id", "laser");
  declearParam<double>("range_min", 0.05);
  declearParam<double>("range_max", 25);
  declearParam<bool>("intensities", true);
  declearParam<std::string>("pub_topic", "scan");

  #ifdef USE_DIAGNOSTICS
  declearParam<double>("diagnostics_tolerance", 0.1);
  declearParam<int>("diagnostics_windows_time", 1);
  #endif

  declearParam<bool>("ip_change", false);
  declearParam<std::string>("prev_addr", "");
  declearParam<std::string>("new_addr", "");
  declearParam<float>("angle_min", -45.0);
  declearParam<float>("angle_max", 225.0);
  declearParam<float>("angle_offset", 0.0);
  declearParam<std::string>("password", "0000");

  ip_addr = this->get_parameter("addr").get_value<std::string>();
  port_number = this->get_parameter("port").get_value<uint16_t>();
  frame_id = this->get_parameter("frame_id").get_value<std::string>();
  range_min = this->get_parameter("range_min").get_value<double>();
  range_max = this->get_parameter("range_max").get_value<double>();
  intensities = this->get_parameter("intensities").get_value<bool>();
  pub_topic = this->get_parameter("pub_topic").get_value<std::string>();

  #ifdef USE_DIAGNOSTICS
  diagnostics_tolerance = this->get_parameter("diagnostics_tolerance").get_value<double>();
  diagnostics_windows_time = (int) this->get_parameter("diagnostics_windows_time").get_value<int>();
  #endif

  ip_change = this->get_parameter("ip_change").get_value<bool>();
  prev_addr = this->get_parameter("prev_addr").get_value<std::string>();
  new_addr = this->get_parameter("new_addr").get_value<std::string>();
  angle_min = this->get_parameter("angle_min").get_value<float>();
  angle_max = this->get_parameter("angle_max").get_value<float>();
  angle_offset = this->get_parameter("angle_offset").get_value<float>();
  password = this->get_parameter("password").get_value<std::string>();
  diagnostic_param_setting = true;

  param_callback_ = this->add_on_set_parameters_callback(
  std::bind(&Autolidar::param_callback, this, std::placeholders::_1));

  if(ip_change == true && (prev_addr != "") && (new_addr != ""))
  {
    std::cout << "ip change :" << ip_change << std::endl;
    std::cout << "prev_addr :" << prev_addr << std::endl;
    std::cout << "new_addr :" << new_addr << std::endl;
    addrChange();
  }

  if(comm_ == nullptr)
  {
    std::shared_ptr<Communication> comm_type = std::make_shared<tcpComm>();
    setCommType(comm_type);
  }

  if(parser_ == nullptr)
  {
    std::shared_ptr<Parser> parser = std::make_shared<AsciiParser>();
    setParser(parser);
  }

  if(comm_->CommConnect(ip_addr, port_number) < 0)
  {
    RCLCPP_ERROR(this->get_logger(), "failed to connect device");
    while(rclcpp::ok())
    {
      comm_->CommDisconnect();

      if(comm_->CommConnect(ip_addr, port_number) < 0)
      {
        reconnect_cnt++;
        if(errno == 111)
        {
          std::this_thread::sleep_for(std::chrono::milliseconds(1000));
        }

        if(reconnect_cnt >= RECONNECT_TRY_COUNT)
        {
          return -1;
        }
        RCLCPP_INFO(this->get_logger(), "trying to reconnect, ip : %s", ip_addr.c_str());
      }
      else
      {
        reconnect_cnt = 0;
        break;
      }
    }
  }

  lsc_ = std::make_shared<Lsc_t>();
  scan_msg_ = std::make_shared<sensor_msgs::msg::LaserScan>();
  laser_topic_publisher_ = this->create_publisher<sensor_msgs::msg::LaserScan>(pub_topic, rclcpp::QoS(rclcpp::SystemDefaultsQoS()));

  lsc_init();
  
  /// receive firstdummy data
  if(get_response("FirstConnectDummySend") < 0)
  {
    RCLCPP_INFO(this->get_logger(), "failed to get firstdummydata");
  }
  send_command("SensorScanInfo");

  login(password);

  send_command("LSScanDataConfig");
  lsc_->scan_data_config.rssi_activate = (uint8_t)intensities;
  setScanAngle();

#ifdef USE_DIAGNOSTICS
  diagnostic_updater_laser_.add("Connection", this, &Autolidar::check_connection);
  diagnostic_updater_laser_.setHardwareID(lsc_->scan_info.model_name);
  min_freq_ = 0.00025;  /// Hz
  max_freq_ = 15.0;     /// Hz

  scan_pub_freq_.reset(new diagnostic_updater::HeaderlessTopicDiagnostic(
    pub_topic, \
    diagnostic_updater_laser_, \
    diagnostic_updater::FrequencyStatusParam(&min_freq_, &max_freq_, diagnostics_tolerance, diagnostics_windows_time)
    ));

#endif

  send_command("SensorStart");
  pub_timer_ = this->create_wall_timer(10ms, std::bind(&Autolidar::run, this));

  return 0;
}

void Autolidar::run()
{
  if(comm_->IsConnected() == false)
  {
    comm_->CommDisconnect();

    if(comm_->CommConnect(ip_addr, port_number) < 0)
    {
      if(errno == 111)
      {
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
      }
      RCLCPP_INFO(this->get_logger(), "trying to reconnect");
    }
    else
    {
      send_command("SensorStart");
    }
  }

  if(!comm_->recvQueue.empty())
  {
    parser_->parsingMsg(comm_->recvQueue.front(), lsc_);
    comm_->recvQueue.pop();

    if(!lsc_->scan_mea.ranges.empty())
    {
      publish_laserscan(scan_msg_, lsc_);
      #ifdef USE_DIAGNOSTICS
        if(diagnostic_param_setting)
        {
          scan_pub_freq_->tick();
        }

      #endif
    }
  }
}